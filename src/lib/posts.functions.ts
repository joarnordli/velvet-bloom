import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createPostInput = z.object({
  body: z.string().trim().min(1).max(500),
  imagePath: z.string().max(300).nullable().optional(),
});

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createPostInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("posts").insert({
      author_id: userId,
      body: data.body,
      image_path: data.imagePath ?? null,
    });
    if (error) throw new Error(error.message);
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

type PostRow = {
  id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  author_id: string;
  repost_of: string | null;
};

const POST_COLUMNS = "id, body, image_path, created_at, author_id, repost_of";

export async function mapPostRows(
  supabase: SupabaseClient,
  userId: string,
  rows: PostRow[],
): Promise<FeedPost[]> {
  if (!rows.length) return [];

  // Hydrate original posts referenced by reposts.
  const originalIds = Array.from(
    new Set(rows.map((r) => r.repost_of).filter((v): v is string => !!v)),
  );
  let originals: PostRow[] = [];
  if (originalIds.length) {
    const { data: origData } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .in("id", originalIds);
    originals = (origData ?? []) as PostRow[];
  }
  const originalById = new Map(originals.map((o) => [o.id, o]));

  // For like/comment counts we count against the *effective* post id:
  // reposts inherit counts from the original.
  const effectiveIdFor = (r: PostRow) => r.repost_of ?? r.id;
  const effectiveIds = Array.from(new Set(rows.map(effectiveIdFor)));

  const authorIds = Array.from(
    new Set([
      ...rows.map((r) => r.author_id),
      ...originals.map((o) => o.author_id),
    ]),
  );

  // Effective authors (original author for reposts, else post author)
  const effectiveAuthorById = new Map<string, string>();
  for (const r of rows) {
    if (r.repost_of) {
      const o = originalById.get(r.repost_of);
      effectiveAuthorById.set(r.id, o?.author_id ?? r.author_id);
    } else {
      effectiveAuthorById.set(r.id, r.author_id);
    }
  }
  const effectiveAuthorIds = Array.from(
    new Set([...effectiveAuthorById.values()].filter((id) => id !== userId)),
  );

  // For repost counts on the effective posts.
  const [
    { data: profilesData },
    { data: likesData },
    { data: myLikesData },
    { data: commentsData },
    { data: repostsData },
    { data: myRepostsData },
    { data: privacyData },
    { data: iFollowData },
    { data: followsMeData },
  ] = await Promise.all([
    supabase.from("profiles").select("id, username, avatar_path").in("id", authorIds),
    supabase.from("post_likes").select("post_id").in("post_id", effectiveIds),
    supabase
      .from("post_likes")
      .select("post_id")
      .in("post_id", effectiveIds)
      .eq("user_id", userId),
    supabase.from("post_comments").select("post_id").in("post_id", effectiveIds),
    supabase.from("posts").select("repost_of").in("repost_of", effectiveIds),
    supabase
      .from("posts")
      .select("repost_of")
      .in("repost_of", effectiveIds)
      .eq("author_id", userId),
    effectiveAuthorIds.length
      ? supabase.rpc("get_privacy_flags", { uuids: effectiveAuthorIds })
      : Promise.resolve({ data: [] as Array<{ user_id: string; allow_engagement_from: string }> }),

    effectiveAuthorIds.length
      ? supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", userId)
          .in("following_id", effectiveAuthorIds)
      : Promise.resolve({ data: [] as Array<{ following_id: string }> }),
    effectiveAuthorIds.length
      ? supabase
          .from("follows")
          .select("follower_id")
          .eq("following_id", userId)
          .in("follower_id", effectiveAuthorIds)
      : Promise.resolve({ data: [] as Array<{ follower_id: string }> }),
  ]);

  const usernames: Record<string, string> = {};
  const avatarPaths: Record<string, string | null> = {};
  for (const p of profilesData ?? []) {
    usernames[p.id] = p.username;
    avatarPaths[p.id] = p.avatar_path;
  }

  const audienceByAuthor = new Map<string, "everyone" | "followers" | "mutuals" | "nobody">();
  for (const r of privacyData ?? [])
    audienceByAuthor.set(
      r.user_id,
      (r.allow_engagement_from ?? "everyone") as "everyone" | "followers" | "mutuals" | "nobody",
    );
  const iFollow = new Set((iFollowData ?? []).map((r) => r.following_id));
  const followsMe = new Set((followsMeData ?? []).map((r) => r.follower_id));

  const likeCounts: Record<string, number> = {};
  for (const r of likesData ?? []) likeCounts[r.post_id] = (likeCounts[r.post_id] ?? 0) + 1;
  const likedByMe = new Set((myLikesData ?? []).map((r) => r.post_id));

  const commentCounts: Record<string, number> = {};
  for (const r of commentsData ?? [])
    commentCounts[r.post_id] = (commentCounts[r.post_id] ?? 0) + 1;

  const repostCounts: Record<string, number> = {};
  for (const r of repostsData ?? []) {
    if (r.repost_of) repostCounts[r.repost_of] = (repostCounts[r.repost_of] ?? 0) + 1;
  }
  const repostedByMe = new Set(
    (myRepostsData ?? []).map((r) => r.repost_of).filter((v): v is string => !!v),
  );

  // Sign image URLs for any image_path across rows and originals.
  const allImagePaths = Array.from(
    new Set(
      [...rows, ...originals]
        .map((r) => r.image_path)
        .filter((p): p is string => !!p),
    ),
  );
  const signed: Record<string, string> = {};
  if (allImagePaths.length) {
    const { data: signedList } = await supabase.storage
      .from("post-media")
      .createSignedUrls(allImagePaths, 60 * 60);
    for (const item of signedList ?? []) {
      if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
    }
  }

  const signedAvatars: Record<string, string> = {};
  const avatarList = Array.from(
    new Set(Object.values(avatarPaths).filter((p): p is string => !!p)),
  );
  if (avatarList.length) {
    const { data: signedAvatarList } = await supabase.storage
      .from("avatars")
      .createSignedUrls(avatarList, 60 * 60);
    for (const item of signedAvatarList ?? []) {
      if (item.path && item.signedUrl) signedAvatars[item.path] = item.signedUrl;
    }
  }

  const mapOriginal = (r: PostRow): RepostOriginal => {
    const ap = avatarPaths[r.author_id] ?? null;
    return {
      id: r.id,
      body: r.body,
      imageUrl: r.image_path ? (signed[r.image_path] ?? null) : null,
      createdAt: r.created_at,
      author: {
        id: r.author_id,
        username: usernames[r.author_id] ?? "ukjent",
        avatarUrl: ap ? (signedAvatars[ap] ?? null) : null,
      },
      mine: r.author_id === userId,
    };
  };

  return rows.map((r) => {
    const ap = avatarPaths[r.author_id] ?? null;
    const effId = effectiveIdFor(r);
    let repostOf: RepostOriginal | null = null;
    if (r.repost_of) {
      const orig = originalById.get(r.repost_of);
      repostOf = orig
        ? mapOriginal(orig)
        : {
            id: r.repost_of,
            body: "",
            imageUrl: null,
            createdAt: r.created_at,
            author: { id: "", username: "ukjent", avatarUrl: null },
            deleted: true,
          };
    }
    const engAuthorId = effectiveAuthorById.get(r.id) ?? r.author_id;
    const aud = audienceByAuthor.get(engAuthorId) ?? "everyone";
    let canEngage: boolean;
    if (engAuthorId === userId) canEngage = true;
    else if (aud === "everyone") canEngage = true;
    else if (aud === "nobody") canEngage = false;
    else if (aud === "followers")
      canEngage = iFollow.has(engAuthorId) || followsMe.has(engAuthorId);
    else if (aud === "mutuals")
      canEngage = iFollow.has(engAuthorId) && followsMe.has(engAuthorId);
    else canEngage = false;
    return {
      id: r.id,
      body: r.body,
      imageUrl: r.image_path ? (signed[r.image_path] ?? null) : null,
      createdAt: r.created_at,
      author: {
        id: r.author_id,
        username: usernames[r.author_id] ?? "ukjent",
        avatarUrl: ap ? (signedAvatars[ap] ?? null) : null,
      },
      likeCount: likeCounts[effId] ?? 0,
      commentCount: commentCounts[effId] ?? 0,
      likedByMe: likedByMe.has(effId),
      repostCount: repostCounts[effId] ?? 0,
      repostedByMe: repostedByMe.has(effId),
      repostOf,
      mine: r.author_id === userId,
      viewerCanEngage: canEngage,
      engagementAudience: aud,
    };
  });
}

async function fetchFolgerFeed(
  supabase: SupabaseClient,
  userId: string,
): Promise<FeedPost[]> {
  const { data: follows } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  const authorIds = Array.from(
    new Set<string>([userId, ...((follows ?? []).map((f) => f.following_id as string))]),
  );
  const { data: rows, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .in("author_id", authorIds)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return mapPostRows(supabase, userId, (rows ?? []) as PostRow[]);
}

async function fetchAnbefaltFeed(
  supabase: SupabaseClient,
  userId: string,
): Promise<FeedPost[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const mapped = await mapPostRows(supabase, userId, (rows ?? []) as PostRow[]);

  const { data: follows } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  const followSet = new Set((follows ?? []).map((f) => f.following_id as string));

  const HALF_LIFE_H = 48;
  const now = Date.now();

  const scored = mapped.map((p) => {
    const ageH = Math.max(0, (now - new Date(p.createdAt).getTime()) / 3_600_000);
    const recency = Math.pow(0.5, ageH / HALF_LIFE_H);
    const engagement = Math.log1p(p.likeCount + 2 * p.commentCount + 1.5 * p.repostCount);
    const followBoost = followSet.has(p.author.id) ? 1.25 : 1;
    const ownPenalty = p.author.id === userId ? 0.4 : 1;
    const score = (0.6 * recency + 0.4 * engagement) * followBoost * ownPenalty;
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50).map((s) => s.p);
}

const feedInput = z.object({
  view: z.enum(["anbefalt", "folger"]).default("anbefalt"),
});

export const getFeedPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => feedInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const { supabase, userId } = context;
    if (data.view === "folger") return fetchFolgerFeed(supabase, userId);
    return fetchAnbefaltFeed(supabase, userId);
  });

const searchInput = z.object({ q: z.string().trim().min(2).max(100) });

export const searchPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const { supabase, userId } = context;
    const safe = data.q.replace(/[\\%_]/g, (m) => "\\" + m);
    const { data: rows, error } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .ilike("body", `%${safe}%`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return mapPostRows(supabase, userId, (rows ?? []) as PostRow[]);
  });

export type UserHit = {
  id: string;
  username: string;
  bio: string | null;
  avatar_url: string | null;
};

export const searchAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(
    async ({ data, context }): Promise<{ users: UserHit[]; posts: FeedPost[] }> => {
      const { supabase, userId } = context;
      const safe = data.q.replace(/[\\%_]/g, (m) => "\\" + m);

      const [usersRes, postsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, username, avatar_path")
          .ilike("username", `%${safe}%`)
          .neq("id", userId)
          .order("username", { ascending: true })
          .limit(5),
        supabase
          .from("posts")
          .select(POST_COLUMNS)
          .ilike("body", `%${safe}%`)
          .neq("author_id", userId)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      if (usersRes.error) throw new Error(usersRes.error.message);
      if (postsRes.error) throw new Error(postsRes.error.message);

      const userRows = usersRes.data ?? [];
      const avatarPaths = Array.from(
        new Set(
          userRows.map((u) => u.avatar_path).filter((p): p is string => !!p),
        ),
      );
      const signed: Record<string, string> = {};
      if (avatarPaths.length) {
        const { data: signedList } = await supabase.storage
          .from("avatars")
          .createSignedUrls(avatarPaths, 60 * 60);
        for (const item of signedList ?? []) {
          if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
        }
      }

      // Bio is privacy-gated: fetch it through get_profile_card so private
      // accounts surface in discovery by username/avatar but never leak their
      // bio to non-followers. (≤5 hits.)
      const bioByUser = new Map<string, string | null>();
      await Promise.all(
        userRows.map(async (u) => {
          const { data: card } = await supabase.rpc("get_profile_card", {
            _target: u.id,
          });
          bioByUser.set(u.id, card?.[0]?.bio ?? null);
        }),
      );

      const users: UserHit[] = userRows.map((u) => ({
        id: u.id,
        username: u.username,
        bio: bioByUser.get(u.id) ?? null,
        avatar_url: u.avatar_path ? (signed[u.avatar_path] ?? null) : null,
      }));

      const posts = await mapPostRows(
        supabase,
        userId,
        (postsRes.data ?? []) as PostRow[],
      );
      return { users, posts };
    },
  );

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

async function signAvatar(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile | null> => {
    const { supabase, userId } = context;
    // Sensitive columns are no longer directly SELECTable; the gated RPC
    // returns full details for self (can_view is always true here).
    const { data: cardRows, error } = await supabase.rpc("get_profile_card", {
      _target: userId,
    });
    if (error) throw new Error(error.message);
    const data = cardRows?.[0];
    if (!data) return null;
    const [followers, following] = await Promise.all([
      supabase
        .from("follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("following_id", userId),
      supabase
        .from("follows")
        .select("following_id", { count: "exact", head: true })
        .eq("follower_id", userId),
    ]);
    return {
      ...data,
      avatar_url: await signAvatar(supabase, data.avatar_path),
      followerCount: followers.count ?? 0,
      followingCount: following.count ?? 0,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(data) as (keyof typeof data)[]) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeedPost[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("author_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return mapPostRows(supabase, userId, (data ?? []) as PostRow[]);
  });

const postIdInput = z.object({ postId: z.string().uuid() });

export const getPostById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => postIdInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost | null> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("id", data.postId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const [mapped] = await mapPostRows(supabase, userId, [row as PostRow]);
    return mapped ?? null;
  });

const deleteInput = z.object({ postId: z.string().uuid() });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: rowErr } = await supabase
      .from("posts")
      .select("id, author_id, image_path")
      .eq("id", data.postId)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) return { ok: true };
    if (row.author_id !== userId) throw new Error("Ikke tillatt");

    if (row.image_path) {
      // Best-effort; ignore storage errors.
      await supabase.storage.from("post-media").remove([row.image_path]);
    }

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", data.postId)
      .eq("author_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateBodyInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

export const updatePostBody = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateBodyInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("posts")
      .update({ body: data.body })
      .eq("id", data.postId)
      .eq("author_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
