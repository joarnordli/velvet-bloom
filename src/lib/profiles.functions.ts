import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { followRequests, follows, posts, profiles } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { canViewProfile, isAccountPrivate } from "./authz.server";
import { presignDownload } from "./storage.server";
import { mapPostRows } from "./post-hydrate.server";
import type { FeedPost } from "@/lib/posts.functions";

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

export const getUserProfileByUsername = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<PublicProfile> => {
    const { userId } = context;
    // Identity (username/avatar) is always readable; sensitive detail columns
    // are gated by canViewProfile (replaces the old get_profile_card RPC).
    const rows = await db
      .select({
        id: profiles.id,
        username: profiles.username,
        avatarPath: profiles.avatarPath,
        region: profiles.region,
        gender: profiles.gender,
        situation: profiles.situation,
        lookingFor: profiles.lookingFor,
        orientation: profiles.orientation,
        bio: profiles.bio,
        kinks: profiles.kinks,
      })
      .from(profiles)
      .where(eq(profiles.username, data.username))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound();

    const isMe = row.id === userId;
    const [
      [{ followerCount }],
      [{ followingCount }],
      mine,
      isPrivate,
      request,
      canView,
    ] = await Promise.all([
      db
        .select({ followerCount: sql<number>`count(*)::int` })
        .from(follows)
        .where(eq(follows.followingId, row.id)),
      db
        .select({ followingCount: sql<number>`count(*)::int` })
        .from(follows)
        .where(eq(follows.followerId, row.id)),
      isMe
        ? Promise.resolve([] as Array<{ x: string }>)
        : db
            .select({ x: follows.followerId })
            .from(follows)
            .where(and(eq(follows.followerId, userId), eq(follows.followingId, row.id)))
            .limit(1),
      isAccountPrivate(row.id),
      isMe
        ? Promise.resolve([] as Array<{ x: string }>)
        : db
            .select({ x: followRequests.requesterId })
            .from(followRequests)
            .where(and(eq(followRequests.requesterId, userId), eq(followRequests.targetId, row.id)))
            .limit(1),
      canViewProfile(userId, row.id),
    ]);

    const isFollowing = !isMe && mine.length > 0;
    const hasRequested = !isMe && request.length > 0;

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

    // Only expose detail columns when the viewer is allowed to see them.
    const detail = canView
      ? {
          region: row.region,
          gender: row.gender,
          situation: row.situation,
          looking_for: row.lookingFor,
          orientation: row.orientation,
          bio: row.bio,
          kinks: row.kinks ?? [],
        }
      : {
          region: null,
          gender: null,
          situation: null,
          looking_for: null,
          orientation: null,
          bio: null,
          kinks: [] as string[],
        };

    return {
      id: row.id,
      username: row.username,
      ...detail,
      avatar_url: row.avatarPath ? await presignDownload(row.avatarPath) : null,
      isMe,
      isPrivate,
      viewState,
      followStatus,
      followerCount: followerCount ?? 0,
      followingCount: followingCount ?? 0,
      isFollowing,
    };
  });

export const getUserPostsByUsername = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<FeedPost[]> => {
    const { userId } = context;
    const prof = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.username, data.username))
      .limit(1);
    if (!prof.length) return [];

    // Private accounts: only followers (or self) see the posts.
    if (!(await canViewProfile(userId, prof[0].id))) return [];

    const rows = await db
      .select({
        id: posts.id,
        body: posts.body,
        imagePath: posts.imagePath,
        createdAt: posts.createdAt,
        authorId: posts.authorId,
        repostOf: posts.repostOf,
      })
      .from(posts)
      .where(eq(posts.authorId, prof[0].id))
      .orderBy(desc(posts.createdAt))
      .limit(100);
    return mapPostRows(userId, rows);
  });
