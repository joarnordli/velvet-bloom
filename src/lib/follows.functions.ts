import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { followRequests, follows, profiles } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { isAccountPrivate } from "./authz.server";
import { notifySimple, unnotifyFollowRequest } from "./notify.server";
import { presignDownloadMany } from "./storage.server";

const usernameInput = z.object({ username: z.string().trim().min(1).max(60) });
const idInput = z.object({ requesterId: z.string().uuid() });

async function resolveUserId(username: string): Promise<string | null> {
  const r = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  return r[0]?.id ?? null;
}

export type FollowResult = { status: "following" | "requested" };

export const followUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<FollowResult> => {
    const { userId } = context;
    const targetId = await resolveUserId(data.username);
    if (!targetId) throw new Error("Bruker finnes ikke");
    if (targetId === userId) throw new Error("Du kan ikke følge deg selv");

    const existing = await db
      .select({ x: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.followingId, targetId)))
      .limit(1);
    if (existing.length) return { status: "following" };

    if (await isAccountPrivate(targetId)) {
      await db
        .insert(followRequests)
        .values({ requesterId: userId, targetId })
        .onConflictDoNothing();
      await notifySimple(targetId, userId, "follow_request");
      return { status: "requested" };
    }

    await db
      .insert(follows)
      .values({ followerId: userId, followingId: targetId })
      .onConflictDoNothing();
    await notifySimple(targetId, userId, "follow");
    return { status: "following" };
  });

export const unfollowUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<{ following: false }> => {
    const { userId } = context;
    const targetId = await resolveUserId(data.username);
    if (!targetId) return { following: false };

    await db
      .delete(followRequests)
      .where(and(eq(followRequests.requesterId, userId), eq(followRequests.targetId, targetId)));
    await unnotifyFollowRequest(targetId, userId);
    await db
      .delete(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.followingId, targetId)));
    return { following: false };
  });

export type IncomingFollowRequest = {
  requesterId: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
};

export const listIncomingFollowRequests = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<IncomingFollowRequest[]> => {
    const { userId } = context;
    const rows = await db
      .select({ requesterId: followRequests.requesterId, createdAt: followRequests.createdAt })
      .from(followRequests)
      .where(eq(followRequests.targetId, userId))
      .orderBy(desc(followRequests.createdAt))
      .limit(200);
    if (!rows.length) return [];

    const ids = rows.map((r) => r.requesterId);
    const profs = await db
      .select({ id: profiles.id, username: profiles.username, avatarPath: profiles.avatarPath })
      .from(profiles)
      .where(inArray(profiles.id, ids));

    const signed = await presignDownloadMany(profs.map((p) => p.avatarPath));
    const profById = new Map(profs.map((p) => [p.id, p] as const));
    return rows.map((r) => {
      const p = profById.get(r.requesterId);
      return {
        requesterId: r.requesterId,
        username: p?.username ?? "ukjent",
        avatarUrl: p?.avatarPath ? signed[p.avatarPath] ?? null : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  });

export const acceptFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => idInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const row = await db
      .select({ x: followRequests.requesterId })
      .from(followRequests)
      .where(
        and(eq(followRequests.requesterId, data.requesterId), eq(followRequests.targetId, userId)),
      )
      .limit(1);
    if (!row.length) throw new Error("Forespørsel finnes ikke");

    await db
      .insert(follows)
      .values({ followerId: data.requesterId, followingId: userId })
      .onConflictDoNothing();
    await db
      .delete(followRequests)
      .where(
        and(eq(followRequests.requesterId, data.requesterId), eq(followRequests.targetId, userId)),
      );
    await unnotifyFollowRequest(userId, data.requesterId);
    await notifySimple(data.requesterId, userId, "follow_accept");
    return { ok: true };
  });

export const rejectFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => idInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await db
      .delete(followRequests)
      .where(
        and(eq(followRequests.requesterId, data.requesterId), eq(followRequests.targetId, userId)),
      );
    await unnotifyFollowRequest(userId, data.requesterId);
    return { ok: true };
  });

export const cancelFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const targetId = await resolveUserId(data.username);
    if (!targetId) return { ok: true };
    await db
      .delete(followRequests)
      .where(and(eq(followRequests.requesterId, userId), eq(followRequests.targetId, targetId)));
    await unnotifyFollowRequest(targetId, userId);
    return { ok: true };
  });
