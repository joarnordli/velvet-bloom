import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapPostRows, type FeedPost } from "@/lib/posts.functions";

export type PublicProfile = {
  id: string;
  username: string;
  region: string | null;
  gender: string | null;
  situation: string | null;
  looking_for: string | null;
  orientation: string | null;
  bio: string | null;
  kinks: string[];
  avatar_url: string | null;
  isMe: boolean;
  isPrivate: boolean;
  viewState: "self" | "public" | "locked" | "unlocked";
  followStatus: "none" | "requested" | "following";
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
};

const usernameInput = z.object({
  username: z.string().trim().min(1).max(60),
});

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

export const getUserProfileByUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<PublicProfile> => {
    const { supabase, userId } = context;
    // Identity is readable by username; sensitive detail columns are not —
    // they come from the privacy-gated get_profile_card RPC below.
    const { data: row, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_path")
      .eq("username", data.username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw notFound();

    const isMe = row.id === userId;
    const [followers, following, mine, privacy, request, cardRes] = await Promise.all([
      supabase
        .from("follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("following_id", row.id),
      supabase
        .from("follows")
        .select("following_id", { count: "exact", head: true })
        .eq("follower_id", row.id),
      isMe
        ? Promise.resolve({ data: null })
        : supabase
            .from("follows")
            .select("follower_id")
            .eq("follower_id", userId)
            .eq("following_id", row.id)
            .maybeSingle(),
      supabase
        .rpc("is_account_private", { _user: row.id }),
      isMe
        ? Promise.resolve({ data: null })
        : supabase
            .from("follow_requests")
            .select("requester_id")
            .eq("requester_id", userId)
            .eq("target_id", row.id)
            .maybeSingle(),
      supabase.rpc("get_profile_card", { _target: row.id }),
    ]);

    const card = cardRes.data?.[0] ?? null;
    const isFollowing = !isMe && !!mine.data;
    const hasRequested = !isMe && !!request.data;
    const isPrivate = !!(privacy.data as boolean | null);

    const followStatus: "none" | "requested" | "following" = isFollowing
      ? "following"
      : hasRequested
        ? "requested"
        : "none";
    const viewState: "self" | "public" | "locked" | "unlocked" = isMe
      ? "self"
      : !isPrivate
        ? "public"
        : isFollowing
          ? "unlocked"
          : "locked";

    return {
      id: row.id,
      username: row.username,
      region: card?.region ?? null,
      gender: card?.gender ?? null,
      situation: card?.situation ?? null,
      looking_for: card?.looking_for ?? null,
      orientation: card?.orientation ?? null,
      bio: card?.bio ?? null,
      kinks: card?.kinks ?? [],
      avatar_url: await signAvatar(supabase, row.avatar_path),
      isMe,
      isPrivate,
      viewState,
      followStatus,
      followerCount: followers.count ?? 0,
      followingCount: following.count ?? 0,
      isFollowing,
    };
  });


export const getUserPostsByUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (!profile) return [];
    const { data: rows, error } = await supabase
      .from("posts")
      .select("id, body, image_path, created_at, author_id, repost_of")
      .eq("author_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return mapPostRows(supabase, userId, rows ?? []);
  });
