import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { follows, posts, profiles } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { canViewProfile, visiblePostsCondition } from "./authz.server";
import { presignDownload, presignDownloadMany, deleteObject } from "./storage.server";
import { mapPostRows, POST_COLUMNS, type PostRow } from "./post-hydrate.server";

const createPostInput = z.object({
  body: z.string().trim().min(1).max(500),
  imagePath: z.string().max(300).nullable().optional(),
});

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => createPostInput.parse(data))
  .handler(async ({ data, context }) => {
    await db.insert(posts).values({
      authorId: context.userId,
      body: data.body,
      imagePath: data.imagePath ?? null,
    });
    return { ok: true };
  });

export type RepostOriginal = {
  id: string;
  body: string;
  imageUrl: string | null;
  createdAt: string;
  author: { id: string; username: string; avatarUrl: string | null };
  deleted?: boolean;
  mine?: boolean;
};

export type FeedPost = {
  id: string;
  body: string;
  imageUrl: string | null;
  createdAt: string;
  author: { id: string; username: string; avatarUrl: string | null };
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  repostCount: number;
  repostedByMe: boolean;
  repostOf: RepostOriginal | null;
  mine: boolean;
  viewerCanEngage: boolean;
  engagementAudience: "everyone" | "followers" | "mutuals" | "nobody";
};

export type FeedPage = { posts: FeedPost[]; nextCursor: string | null };

// Posts per page. Small because each page hydrates per-post counts + signed
// URLs (mapPostRows); 15 keeps first paint fast on this media-heavy feed.
const FEED_PAGE_SIZE = 15;

// Cursor = the previous page's chronologically-oldest created_at. We page by
// created_at only (.lt); exact-timestamp ties at a page boundary are vanishingly
// rare, and a composite (created_at, id) cursor is the hardening option if needed.
async function fetchFolgerFeed(userId: string, cursor: string | null): Promise<FeedPage> {
  const followRows = await db
    .select({ followingId: follows.followingId })
    .from(follows)
    .where(eq(follows.followerId, userId));
  const authorIds = Array.from(new Set<string>([userId, ...followRows.map((f) => f.followingId)]));

  const list = await db
    .select(POST_COLUMNS)
    .from(posts)
    .where(
      and(
        inArray(posts.authorId, authorIds),
        // Excludes posts from users blocked in either direction (a follow you
        // later blocked shouldn't keep showing up).
        visiblePostsCondition(userId),
        cursor ? sql`${posts.createdAt} < ${cursor}` : undefined,
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(FEED_PAGE_SIZE);

  const mapped = await mapPostRows(userId, list);
  const nextCursor =
    list.length === FEED_PAGE_SIZE ? list[list.length - 1].createdAt.toISOString() : null;
  return { posts: mapped, nextCursor };
}

async function fetchAnbefaltFeed(userId: string, cursor: string | null): Promise<FeedPage> {
  const list = await db
    .select(POST_COLUMNS)
    .from(posts)
    .where(
      and(
        // Privacy gate: hide posts from private accounts the viewer doesn't
        // follow, and from blocked users (either direction).
        visiblePostsCondition(userId),
        cursor ? sql`${posts.createdAt} < ${cursor}` : undefined,
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(FEED_PAGE_SIZE);

  // Next page continues chronologically — capture the boundary BEFORE re-sorting.
  const nextCursor =
    list.length === FEED_PAGE_SIZE ? list[list.length - 1].createdAt.toISOString() : null;

  const mapped = await mapPostRows(userId, list);

  // Re-rank this page by recency + engagement (ordering is per-page, not global).
  const HALF_LIFE_H = 48;
  const now = Date.now();
  const scored = mapped.map((p) => {
    const ageH = Math.max(0, (now - new Date(p.createdAt).getTime()) / 3_600_000);
    const recency = Math.pow(0.5, ageH / HALF_LIFE_H);
    const engagement = Math.log1p(p.likeCount + 2 * p.commentCount + 1.5 * p.repostCount);
    const score = 0.6 * recency + 0.4 * engagement;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { posts: scored.map((s) => s.p), nextCursor };
}

const feedInput = z.object({
  view: z.enum(["anbefalt", "folger"]).default("anbefalt"),
  cursor: z.string().nullable().optional(),
});

export const getFeedPosts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => feedInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<FeedPage> => {
    const cursor = data.cursor ?? null;
    if (data.view === "folger") return fetchFolgerFeed(context.userId, cursor);
    return fetchAnbefaltFeed(context.userId, cursor);
  });

const searchInput = z.object({ q: z.string().trim().min(2).max(100) });

export const searchPosts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const safe = data.q.replace(/[\\%_]/g, (m) => "\\" + m);
    const rows = await db
      .select(POST_COLUMNS)
      .from(posts)
      .where(and(ilike(posts.body, `%${safe}%`), visiblePostsCondition(context.userId)))
      .orderBy(desc(posts.createdAt))
      .limit(50);
    return mapPostRows(context.userId, rows);
  });

export type UserHit = {
  id: string;
  username: string;
  bio: string | null;
  avatar_url: string | null;
};

export const searchAll = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data, context }): Promise<{ users: UserHit[]; posts: FeedPost[] }> => {
    const { userId } = context;
    const safe = data.q.replace(/[\\%_]/g, (m) => "\\" + m);

    const [userRows, postRows] = await Promise.all([
      db
        .select({
          id: profiles.id,
          username: profiles.username,
          avatarPath: profiles.avatarPath,
          bio: profiles.bio,
        })
        .from(profiles)
        .where(and(ilike(profiles.username, `%${safe}%`), ne(profiles.id, userId)))
        .orderBy(profiles.username)
        .limit(5),
      db
        .select(POST_COLUMNS)
        .from(posts)
        .where(
          and(
            ilike(posts.body, `%${safe}%`),
            ne(posts.authorId, userId),
            visiblePostsCondition(userId),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(60),
    ]);

    const signed = await presignDownloadMany(userRows.map((u) => u.avatarPath));

    // Bio is privacy-gated: only surface it to viewers who can see the profile
    // (private accounts still appear by username/avatar in discovery).
    const users: UserHit[] = await Promise.all(
      userRows.map(async (u) => ({
        id: u.id,
        username: u.username,
        bio: (await canViewProfile(userId, u.id)) ? u.bio : null,
        avatar_url: u.avatarPath ? signed[u.avatarPath] ?? null : null,
      })),
    );

    const mappedPosts = await mapPostRows(userId, postRows);
    return { users, posts: mappedPosts };
  });

export type MyProfile = {
  id: string;
  username: string;
  region: string | null;
  gender: string | null;
  situation: string | null;
  looking_for: string | null;
  orientation: string | null;
  bio: string | null;
  kinks: string[];
  avatar_path: string | null;
  avatar_url: string | null;
  created_at: string;
  followerCount: number;
  followingCount: number;
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<MyProfile | null> => {
    const { userId } = context;
    const rows = await db
      .select({
        id: profiles.id,
        username: profiles.username,
        region: profiles.region,
        gender: profiles.gender,
        situation: profiles.situation,
        looking_for: profiles.lookingFor,
        orientation: profiles.orientation,
        bio: profiles.bio,
        kinks: profiles.kinks,
        avatar_path: profiles.avatarPath,
        created_at: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const data = rows[0];
    if (!data) return null;

    const [[{ followerCount }], [{ followingCount }]] = await Promise.all([
      db
        .select({ followerCount: sql<number>`count(*)::int` })
        .from(follows)
        .where(eq(follows.followingId, userId)),
      db
        .select({ followingCount: sql<number>`count(*)::int` })
        .from(follows)
        .where(eq(follows.followerId, userId)),
    ]);

    return {
      ...data,
      created_at: data.created_at.toISOString(),
      avatar_url: data.avatar_path ? await presignDownload(data.avatar_path) : null,
      followerCount: followerCount ?? 0,
      followingCount: followingCount ?? 0,
    };
  });

const updateInput = z.object({
  region: z.string().trim().max(80).nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  situation: z.string().trim().max(80).nullable().optional(),
  looking_for: z.string().trim().max(300).nullable().optional(),
  orientation: z.string().trim().max(40).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  kinks: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  avatar_path: z.string().max(300).nullable().optional(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }) => {
    const set: Record<string, unknown> = {};
    if (data.region !== undefined) set.region = data.region;
    if (data.gender !== undefined) set.gender = data.gender;
    if (data.situation !== undefined) set.situation = data.situation;
    if (data.looking_for !== undefined) set.lookingFor = data.looking_for;
    if (data.orientation !== undefined) set.orientation = data.orientation;
    if (data.bio !== undefined) set.bio = data.bio;
    if (data.kinks !== undefined) set.kinks = data.kinks;
    if (data.avatar_path !== undefined) set.avatarPath = data.avatar_path;
    if (Object.keys(set).length === 0) return { ok: true };
    await db.update(profiles).set(set).where(eq(profiles.id, context.userId));
    return { ok: true };
  });

export const getMyPosts = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<FeedPost[]> => {
    const rows = await db
      .select(POST_COLUMNS)
      .from(posts)
      .where(eq(posts.authorId, context.userId))
      .orderBy(desc(posts.createdAt))
      .limit(100);
    return mapPostRows(context.userId, rows);
  });

const postIdInput = z.object({ postId: z.string().uuid() });

export const getPostById = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => postIdInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost | null> => {
    // visiblePostsCondition gates the single-post fetch too: a private account's
    // post (or a blocked user's) returns null to non-followers, not a 404-vs-403
    // distinction that would leak existence.
    const rows = await db
      .select(POST_COLUMNS)
      .from(posts)
      .where(and(eq(posts.id, data.postId), visiblePostsCondition(context.userId)))
      .limit(1);
    if (!rows.length) return null;
    const [mapped] = await mapPostRows(context.userId, rows);
    return mapped ?? null;
  });

const deleteInput = z.object({ postId: z.string().uuid() });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const rows = await db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        imagePath: posts.imagePath,
        repostOf: posts.repostOf,
      })
      .from(posts)
      .where(eq(posts.id, data.postId))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: true };
    if (row.authorId !== userId) throw new Error("Ikke tillatt");

    if (row.imagePath) {
      // Best-effort; ignore storage errors.
      try {
        await deleteObject(row.imagePath);
      } catch {
        /* ignore */
      }
    }

    await db.delete(posts).where(and(eq(posts.id, data.postId), eq(posts.authorId, userId)));

    // Deleting a repost decrements the original's repostCount. (Deleting an
    // original instead nulls reposts' repost_of via the FK, so its own counters
    // simply vanish with the row.)
    if (row.repostOf) {
      await db
        .update(posts)
        .set({ repostCount: sql`GREATEST(${posts.repostCount} - 1, 0)` })
        .where(eq(posts.id, row.repostOf));
    }
    return { ok: true };
  });

const updateBodyInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

export const updatePostBody = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => updateBodyInput.parse(data))
  .handler(async ({ data, context }) => {
    await db
      .update(posts)
      .set({ body: data.body })
      .where(and(eq(posts.id, data.postId), eq(posts.authorId, context.userId)));
    return { ok: true };
  });
