import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  conversationParticipants,
  conversations,
  messages,
  notifications,
  posts,
  profiles,
} from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { presignDownloadMany } from "./storage.server";

export type NotificationType =
  | "like"
  | "comment"
  | "repost"
  | "follow"
  | "follow_request"
  | "follow_accept";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  createdAt: string;
  readAt: string | null;
  preview: string | null;
  actor: { id: string; username: string; avatarUrl: string | null };
  post: {
    id: string;
    body: string;
    imageUrl: string | null;
  } | null;
};

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<NotificationItem[]> => {
    const { userId } = context;

    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
        preview: notifications.preview,
        actorId: notifications.actorId,
        postId: notifications.postId,
      })
      .from(notifications)
      .where(eq(notifications.recipientId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    if (!rows.length) return [];

    const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
    const postIds = Array.from(new Set(rows.map((r) => r.postId).filter((v): v is string => !!v)));

    const [profs, postRows] = await Promise.all([
      db
        .select({ id: profiles.id, username: profiles.username, avatarPath: profiles.avatarPath })
        .from(profiles)
        .where(inArray(profiles.id, actorIds)),
      postIds.length
        ? db
            .select({ id: posts.id, body: posts.body, imagePath: posts.imagePath })
            .from(posts)
            .where(inArray(posts.id, postIds))
        : Promise.resolve([] as Array<{ id: string; body: string; imagePath: string | null }>),
    ]);

    const signedAvatars = await presignDownloadMany(profs.map((p) => p.avatarPath));
    const signedImages = await presignDownloadMany(postRows.map((p) => p.imagePath));

    const profileById = new Map(profs.map((p) => [p.id, p] as const));
    const postById = new Map(postRows.map((p) => [p.id, p] as const));

    return rows.map((r) => {
      const prof = profileById.get(r.actorId);
      const post = r.postId ? postById.get(r.postId) : undefined;
      return {
        id: r.id,
        type: r.type as NotificationType,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
        preview: r.preview,
        actor: {
          id: r.actorId,
          username: prof?.username ?? "ukjent",
          avatarUrl: prof?.avatarPath ? signedAvatars[prof.avatarPath] ?? null : null,
        },
        post: post
          ? {
              id: post.id,
              body: post.body,
              imageUrl: post.imagePath ? signedImages[post.imagePath] ?? null : null,
            }
          : null,
      };
    });
  });

export const getUnreadCounts = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(
    async ({
      context,
    }): Promise<{ notifications: number; messages: number; messageRequests: number }> => {
      const { userId } = context;

      const [{ notifCount }] = await db
        .select({ notifCount: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));

      const parts = await db
        .select({
          conversationId: conversationParticipants.conversationId,
          lastReadAt: conversationParticipants.lastReadAt,
        })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        );

      const convIds = parts.map((p) => p.conversationId);
      const reqByConv = new Map<string, boolean>();
      if (convIds.length) {
        const convs = await db
          .select({
            id: conversations.id,
            isRequest: conversations.isRequest,
            createdBy: conversations.createdBy,
          })
          .from(conversations)
          .where(inArray(conversations.id, convIds));
        for (const c of convs) {
          // Treat as a request only when *I* did not initiate it.
          reqByConv.set(c.id, !!c.isRequest && c.createdBy !== userId);
        }
      }

      let messageCount = 0;
      let messageRequests = 0;
      for (const p of parts) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, p.conversationId),
              gt(messages.createdAt, p.lastReadAt ?? new Date(0)),
              ne(messages.senderId, userId),
              isNull(messages.deletedAt),
            ),
          );
        if (reqByConv.get(p.conversationId)) messageRequests += count ?? 0;
        else messageCount += count ?? 0;
      }

      return { notifications: notifCount ?? 0, messages: messageCount, messageRequests };
    },
  );

const markInput = z.object({ ids: z.array(z.string().uuid()).optional() });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => markInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const conds = [eq(notifications.recipientId, userId), isNull(notifications.readAt)];
    if (data.ids?.length) conds.push(inArray(notifications.id, data.ids));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...conds));
    return { ok: true };
  });
