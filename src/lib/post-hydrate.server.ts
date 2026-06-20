import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  follows,
  postLikes,
  posts,
  profiles,
  userPrivacySettings,
} from "@/db/schema";
import { presignDownloadMany } from "./storage.server";
import type { FeedPost, RepostOriginal } from "./posts.functions";

/**
 * Server-only post hydration. Lives in a `.server.ts` module (not in
 * posts.functions.ts) because `mapPostRows` is a plain exported helper that
 * imports server-only modules (db, R2 signer) — keeping it here ensures the
 * TanStack Start import-protection never drags Postgres/R2 into the client
 * bundle. Only the `*.functions.ts` server handlers import this.
 */

export type PostRow = {
  id: string;
  body: string;
  imagePath: string | null;
  createdAt: Date;
  authorId: string;
  repostOf: string | null;
  likeCount: number;
  commentCount: number;
  repostCount: number;
};

export const POST_COLUMNS = {
  id: posts.id,
  body: posts.body,
  imagePath: posts.imagePath,
  createdAt: posts.createdAt,
  authorId: posts.authorId,
  repostOf: posts.repostOf,
  likeCount: posts.likeCount,
  commentCount: posts.commentCount,
  repostCount: posts.repostCount,
} as const;

/**
 * Hydrate raw post rows into FeedPosts: authors, signed image/avatar URLs,
 * like/comment/repost counts, viewer engagement flags, and embedded repost
 * originals. Ported from the Supabase/PostgREST version to Drizzle + R2.
 *
 * TODO(scale, Phase 3): counts are computed by fetching all like/comment/repost
 * rows and tallying in JS — fine for seed-scale, a landmine at volume. Denormalize
 * counters onto posts when traffic warrants (see docs/migration-to-self-hosted.md).
 */
export async function mapPostRows(userId: string, rows: PostRow[]): Promise<FeedPost[]> {
  if (!rows.length) return [];

  // Hydrate original posts referenced by reposts.
  const originalIds = Array.from(
    new Set(rows.map((r) => r.repostOf).filter((v): v is string => !!v)),
  );
  let originals: PostRow[] = [];
  if (originalIds.length) {
    originals = await db.select(POST_COLUMNS).from(posts).where(inArray(posts.id, originalIds));
  }
  const originalById = new Map(originals.map((o) => [o.id, o]));

  // Counts are tallied against the *effective* post id (reposts inherit originals').
  const effectiveIdFor = (r: PostRow) => r.repostOf ?? r.id;
  const effectiveIds = Array.from(new Set(rows.map(effectiveIdFor)));

  const authorIds = Array.from(
    new Set([...rows.map((r) => r.authorId), ...originals.map((o) => o.authorId)]),
  );

  // Effective authors (original author for reposts, else post author).
  const effectiveAuthorById = new Map<string, string>();
  for (const r of rows) {
    if (r.repostOf) {
      const o = originalById.get(r.repostOf);
      effectiveAuthorById.set(r.id, o?.authorId ?? r.authorId);
    } else {
      effectiveAuthorById.set(r.id, r.authorId);
    }
  }
  const effectiveAuthorIds = Array.from(
    new Set([...effectiveAuthorById.values()].filter((id) => id !== userId)),
  );

  const [
    profilesData,
    myLikesData,
    myRepostsData,
    privacyData,
    iFollowData,
    followsMeData,
  ] = await Promise.all([
    db
      .select({ id: profiles.id, username: profiles.username, avatarPath: profiles.avatarPath })
      .from(profiles)
      .where(inArray(profiles.id, authorIds)),
    // Viewer's own like/repost flags only (small, bounded by the page). The
    // total counts come from the denormalized columns on posts (below) — no
    // more fetch-all-rows-and-tally.
    db
      .select({ postId: postLikes.postId })
      .from(postLikes)
      .where(and(inArray(postLikes.postId, effectiveIds), eq(postLikes.userId, userId))),
    db
      .select({ repostOf: posts.repostOf })
      .from(posts)
      .where(and(inArray(posts.repostOf, effectiveIds), eq(posts.authorId, userId))),
    effectiveAuthorIds.length
      ? db
          .select({
            userId: userPrivacySettings.userId,
            allowEngagementFrom: userPrivacySettings.allowEngagementFrom,
          })
          .from(userPrivacySettings)
          .where(inArray(userPrivacySettings.userId, effectiveAuthorIds))
      : Promise.resolve([] as Array<{ userId: string; allowEngagementFrom: string }>),
    effectiveAuthorIds.length
      ? db
          .select({ followingId: follows.followingId })
          .from(follows)
          .where(and(eq(follows.followerId, userId), inArray(follows.followingId, effectiveAuthorIds)))
      : Promise.resolve([] as Array<{ followingId: string }>),
    effectiveAuthorIds.length
      ? db
          .select({ followerId: follows.followerId })
          .from(follows)
          .where(and(eq(follows.followingId, userId), inArray(follows.followerId, effectiveAuthorIds)))
      : Promise.resolve([] as Array<{ followerId: string }>),
  ]);

  const usernames: Record<string, string> = {};
  const avatarPaths: Record<string, string | null> = {};
  for (const p of profilesData) {
    usernames[p.id] = p.username;
    avatarPaths[p.id] = p.avatarPath;
  }

  const audienceByAuthor = new Map<string, "everyone" | "followers" | "mutuals" | "nobody">();
  for (const r of privacyData)
    audienceByAuthor.set(
      r.userId,
      (r.allowEngagementFrom ?? "everyone") as "everyone" | "followers" | "mutuals" | "nobody",
    );
  const iFollow = new Set(iFollowData.map((r) => r.followingId));
  const followsMe = new Set(followsMeData.map((r) => r.followerId));

  // Counts come straight from the denormalized columns on the effective post
  // (a row's own counters, or its original's for reposts).
  const countById = new Map<string, { like: number; comment: number; repost: number }>();
  for (const r of [...rows, ...originals]) {
    countById.set(r.id, {
      like: r.likeCount,
      comment: r.commentCount,
      repost: r.repostCount,
    });
  }
  const likedByMe = new Set(myLikesData.map((r) => r.postId));
  const repostedByMe = new Set(
    myRepostsData.map((r) => r.repostOf).filter((v): v is string => !!v),
  );

  // Sign image + avatar URLs (R2 presigned GET, 1h).
  const signed = await presignDownloadMany([...rows, ...originals].map((r) => r.imagePath));
  const signedAvatars = await presignDownloadMany(Object.values(avatarPaths));

  const mapOriginal = (r: PostRow): RepostOriginal => {
    const ap = avatarPaths[r.authorId] ?? null;
    return {
      id: r.id,
      body: r.body,
      imageUrl: r.imagePath ? signed[r.imagePath] ?? null : null,
      createdAt: r.createdAt.toISOString(),
      author: {
        id: r.authorId,
        username: usernames[r.authorId] ?? "ukjent",
        avatarUrl: ap ? signedAvatars[ap] ?? null : null,
      },
      mine: r.authorId === userId,
    };
  };

  return rows.map((r) => {
    const ap = avatarPaths[r.authorId] ?? null;
    const effId = effectiveIdFor(r);
    let repostOf: RepostOriginal | null = null;
    if (r.repostOf) {
      const orig = originalById.get(r.repostOf);
      repostOf = orig
        ? mapOriginal(orig)
        : {
            id: r.repostOf,
            body: "",
            imageUrl: null,
            createdAt: r.createdAt.toISOString(),
            author: { id: "", username: "ukjent", avatarUrl: null },
            deleted: true,
          };
    }
    const engAuthorId = effectiveAuthorById.get(r.id) ?? r.authorId;
    const aud = audienceByAuthor.get(engAuthorId) ?? "everyone";
    let canEngage: boolean;
    if (engAuthorId === userId) canEngage = true;
    else if (aud === "everyone") canEngage = true;
    else if (aud === "nobody") canEngage = false;
    else if (aud === "followers") canEngage = iFollow.has(engAuthorId) || followsMe.has(engAuthorId);
    else if (aud === "mutuals") canEngage = iFollow.has(engAuthorId) && followsMe.has(engAuthorId);
    else canEngage = false;
    return {
      id: r.id,
      body: r.body,
      imageUrl: r.imagePath ? signed[r.imagePath] ?? null : null,
      createdAt: r.createdAt.toISOString(),
      author: {
        id: r.authorId,
        username: usernames[r.authorId] ?? "ukjent",
        avatarUrl: ap ? signedAvatars[ap] ?? null : null,
      },
      likeCount: countById.get(effId)?.like ?? 0,
      commentCount: countById.get(effId)?.comment ?? 0,
      likedByMe: likedByMe.has(effId),
      repostCount: countById.get(effId)?.repost ?? 0,
      repostedByMe: repostedByMe.has(effId),
      repostOf,
      mine: r.authorId === userId,
      viewerCanEngage: canEngage,
      engagementAudience: aud,
    };
  });
}
