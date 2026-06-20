import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  conversationParticipants,
  conversations,
  messageAttachments,
  messages,
  profiles,
} from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import {
  bumpConversation,
  canDm,
  dmStatus,
  getOrCreateDm as getOrCreateDmConversation,
  isConversationMember,
} from "./authz.server";
import { presignDownload, presignDownloadMany } from "./storage.server";

// Signed-URL TTL for chat media (24h — matches the old behaviour).
const MEDIA_TTL = 60 * 60 * 24;

// ===== Types =====

export type ConversationListItem = {
  id: string;
  isGroup: boolean;
  isRequest: boolean;
  isMyRequest: boolean;
  title: string | null;
  lastMessageAt: string;
  lastReadAt: string;
  pinnedAt: string | null;
  unreadCount: number;
  lastMessage: {
    body: string | null;
    senderId: string;
    createdAt: string;
    hasAttachment: boolean;
  } | null;
  participants: Array<{ id: string; username: string; avatarUrl: string | null; isMe: boolean }>;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: Array<{
    id: string;
    url: string;
    mime: string;
    width: number | null;
    height: number | null;
  }>;
};

export type ConversationDetail = {
  id: string;
  isGroup: boolean;
  isRequest: boolean;
  isMyRequest: boolean;
  title: string | null;
  participants: Array<{
    id: string;
    username: string;
    avatarUrl: string | null;
    lastReadAt: string;
    isMe: boolean;
    leftAt: string | null;
  }>;
};

const EPOCH = new Date(0);

// ===== Server fns =====

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z.object({ tab: z.enum(["chats", "requests"]).default("chats") }).parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<ConversationListItem[]> => {
    const { userId } = context;
    const tab = data.tab;

    // 1. My active memberships, with last_read_at + pinned_at.
    const myParts = await db
      .select({
        conversationId: conversationParticipants.conversationId,
        lastReadAt: conversationParticipants.lastReadAt,
        pinnedAt: conversationParticipants.pinnedAt,
      })
      .from(conversationParticipants)
      .where(
        and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.leftAt)),
      );
    if (!myParts.length) return [];

    const convIds = myParts.map((p) => p.conversationId);
    const lastReadById = new Map(myParts.map((p) => [p.conversationId, p.lastReadAt]));
    const pinnedById = new Map(myParts.map((p) => [p.conversationId, p.pinnedAt ?? null]));

    // 2. Conversations.
    const convs = await db
      .select({
        id: conversations.id,
        isGroup: conversations.isGroup,
        title: conversations.title,
        lastMessageAt: conversations.lastMessageAt,
        isRequest: conversations.isRequest,
        createdBy: conversations.createdBy,
      })
      .from(conversations)
      .where(inArray(conversations.id, convIds))
      .orderBy(desc(conversations.lastMessageAt));

    // 3. All participants for these conversations.
    const parts = await db
      .select({
        conversationId: conversationParticipants.conversationId,
        userId: conversationParticipants.userId,
        leftAt: conversationParticipants.leftAt,
      })
      .from(conversationParticipants)
      .where(inArray(conversationParticipants.conversationId, convIds));

    const allActiveUserIds = Array.from(
      new Set(parts.filter((p) => p.leftAt === null).map((p) => p.userId)),
    );

    const profileById = new Map<
      string,
      { id: string; username: string; avatarPath: string | null }
    >();
    if (allActiveUserIds.length) {
      const profs = await db
        .select({ id: profiles.id, username: profiles.username, avatarPath: profiles.avatarPath })
        .from(profiles)
        .where(inArray(profiles.id, allActiveUserIds));
      for (const p of profs) profileById.set(p.id, p);
    }
    const signedAvatars = await presignDownloadMany(
      Array.from(profileById.values()).map((p) => p.avatarPath),
      MEDIA_TTL,
    );

    // 4. Last (non-deleted) message per conversation.
    const lastMsgByConv = new Map<
      string,
      { id: string; conversationId: string; senderId: string; body: string | null; createdAt: Date }
    >();
    await Promise.all(
      convIds.map(async (cid) => {
        const rows = await db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            body: messages.body,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(and(eq(messages.conversationId, cid), isNull(messages.deletedAt)))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        if (rows[0]) lastMsgByConv.set(cid, rows[0]);
      }),
    );

    // Which of those last messages carry an attachment.
    const lastMsgIds = Array.from(lastMsgByConv.values()).map((m) => m.id);
    const withAttachment = new Set<string>();
    if (lastMsgIds.length) {
      const atts = await db
        .select({ messageId: messageAttachments.messageId })
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, lastMsgIds));
      for (const a of atts) withAttachment.add(a.messageId);
    }

    // 5. Unread per conversation (after last_read_at, not from me, not deleted).
    const unreadByConv = new Map<string, number>();
    await Promise.all(
      convIds.map(async (cid) => {
        const after = lastReadById.get(cid) ?? EPOCH;
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, cid),
              gt(messages.createdAt, after),
              ne(messages.senderId, userId),
              isNull(messages.deletedAt),
            ),
          );
        unreadByConv.set(cid, count ?? 0);
      }),
    );

    const items = convs
      .filter((c) => {
        const isReq = !!c.isRequest;
        if (tab === "requests") return isReq && c.createdBy !== userId;
        return !isReq || c.createdBy === userId;
      })
      .map((c) => {
        const convParts = parts.filter((p) => p.conversationId === c.id && p.leftAt === null);
        const participantList = convParts.map((p) => {
          const prof = profileById.get(p.userId);
          return {
            id: p.userId,
            username: prof?.username ?? "ukjent",
            avatarUrl: prof?.avatarPath ? signedAvatars[prof.avatarPath] ?? null : null,
            isMe: p.userId === userId,
          };
        });
        const lm = lastMsgByConv.get(c.id);
        return {
          id: c.id,
          isGroup: c.isGroup,
          isRequest: !!c.isRequest,
          isMyRequest: !!c.isRequest && c.createdBy === userId,
          title: c.title,
          lastMessageAt: c.lastMessageAt.toISOString(),
          lastReadAt: (lastReadById.get(c.id) ?? EPOCH).toISOString(),
          pinnedAt: pinnedById.get(c.id)?.toISOString() ?? null,
          unreadCount: unreadByConv.get(c.id) ?? 0,
          lastMessage: lm
            ? {
                body: lm.body,
                senderId: lm.senderId,
                createdAt: lm.createdAt.toISOString(),
                hasAttachment: withAttachment.has(lm.id),
              }
            : null,
          participants: participantList,
        };
      });

    // Pinned first (by pinnedAt desc), then by lastMessageAt desc.
    items.sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      if (a.pinnedAt && b.pinnedAt) return a.pinnedAt < b.pinnedAt ? 1 : -1;
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    });

    return items;
  });

export const setConversationPin = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid(), pinned: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await db
      .update(conversationParticipants)
      .set({ pinnedAt: data.pinned ? new Date() : null })
      .where(
        and(
          eq(conversationParticipants.conversationId, data.conversationId),
          eq(conversationParticipants.userId, context.userId),
        ),
      );
    return { ok: true };
  });

export const leaveConversation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await db
      .update(conversationParticipants)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, data.conversationId),
          eq(conversationParticipants.userId, context.userId),
        ),
      );
    return { ok: true };
  });

export const getOrCreateDm = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z.object({ username: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ conversationId: string; status: "allowed" | "request" }> => {
      const { userId } = context;
      const prof = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.username, data.username))
        .limit(1);
      if (!prof.length) throw new Error("Bruker finnes ikke");
      const otherId = prof[0].id;

      const status = await dmStatus(userId, otherId);
      if (status === "blocked") {
        throw new Error("Denne brukeren tar ikke imot meldinger fra deg");
      }

      const conversationId = await getOrCreateDmConversation(userId, otherId);

      // Fresh request conversation we initiated → mark it as a request.
      if (status === "request") {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(eq(messages.conversationId, conversationId));
        if ((count ?? 0) === 0) {
          await db
            .update(conversations)
            .set({ isRequest: true })
            .where(and(eq(conversations.id, conversationId), eq(conversations.createdBy, userId)));
        }
      }

      return { conversationId, status: status as "allowed" | "request" };
    },
  );

export const getDmStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z.object({ username: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(
    async ({ data, context }): Promise<{ status: "allowed" | "request" | "blocked" }> => {
      const { userId } = context;
      const prof = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.username, data.username))
        .limit(1);
      if (!prof.length) return { status: "blocked" };
      if (prof[0].id === userId) return { status: "allowed" };
      return { status: await dmStatus(userId, prof[0].id) };
    },
  );

export const acceptMessageRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const rows = await db
      .select({
        id: conversations.id,
        isRequest: conversations.isRequest,
        createdBy: conversations.createdBy,
      })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) throw new Error("Samtale finnes ikke");
    if (!conv.isRequest) return { ok: true };
    if (conv.createdBy === userId) throw new Error("Du kan ikke godta din egen forespørsel");
    await db
      .update(conversations)
      .set({ isRequest: false })
      .where(eq(conversations.id, data.conversationId));
    return { ok: true };
  });

export const declineMessageRequest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await db
      .update(conversationParticipants)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, data.conversationId),
          eq(conversationParticipants.userId, context.userId),
        ),
      );
    return { ok: true };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<ConversationDetail> => {
    const { userId } = context;
    // Membership gate (old msg_select / conv_select RLS).
    if (!(await isConversationMember(data.conversationId, userId))) throw notFound();

    const rows = await db
      .select({
        id: conversations.id,
        isGroup: conversations.isGroup,
        title: conversations.title,
        isRequest: conversations.isRequest,
        createdBy: conversations.createdBy,
      })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) throw notFound();

    const parts = await db
      .select({
        userId: conversationParticipants.userId,
        lastReadAt: conversationParticipants.lastReadAt,
        leftAt: conversationParticipants.leftAt,
      })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, data.conversationId));

    const userIds = parts.map((p) => p.userId);
    const profs = userIds.length
      ? await db
          .select({ id: profiles.id, username: profiles.username, avatarPath: profiles.avatarPath })
          .from(profiles)
          .where(inArray(profiles.id, userIds))
      : [];
    const profById = new Map(profs.map((p) => [p.id, p] as const));
    const signed = await presignDownloadMany(profs.map((p) => p.avatarPath), MEDIA_TTL);

    return {
      id: conv.id,
      isGroup: conv.isGroup,
      isRequest: !!conv.isRequest,
      isMyRequest: !!conv.isRequest && conv.createdBy === userId,
      title: conv.title,
      participants: parts.map((p) => {
        const prof = profById.get(p.userId);
        return {
          id: p.userId,
          username: prof?.username ?? "ukjent",
          avatarUrl: prof?.avatarPath ? signed[prof.avatarPath] ?? null : null,
          lastReadAt: p.lastReadAt.toISOString(),
          isMe: p.userId === userId,
          leftAt: p.leftAt ? p.leftAt.toISOString() : null,
        };
      }),
    };
  });

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        before: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ChatMessage[]> => {
    const { userId } = context;
    // Membership gate (old msg_select RLS).
    if (!(await isConversationMember(data.conversationId, userId))) return [];

    const rows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, data.conversationId),
          data.before ? lt(messages.createdAt, new Date(data.before)) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(data.limit);

    const msgIds = rows.map((m) => m.id);
    const attRows = msgIds.length
      ? await db
          .select({
            id: messageAttachments.id,
            messageId: messageAttachments.messageId,
            storagePath: messageAttachments.storagePath,
            mime: messageAttachments.mime,
            width: messageAttachments.width,
            height: messageAttachments.height,
          })
          .from(messageAttachments)
          .where(inArray(messageAttachments.messageId, msgIds))
      : [];
    const signed = await presignDownloadMany(attRows.map((a) => a.storagePath), MEDIA_TTL);
    const attByMsg = new Map<string, typeof attRows>();
    for (const a of attRows) {
      const list = attByMsg.get(a.messageId) ?? [];
      list.push(a);
      attByMsg.set(a.messageId, list);
    }

    const mapped = rows.map((m): ChatMessage => {
      const atts = (attByMsg.get(m.id) ?? []).map((a) => ({
        id: a.id,
        url: signed[a.storagePath] ?? "",
        mime: a.mime,
        width: a.width,
        height: a.height,
      }));
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        body: m.deletedAt ? null : m.body,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt ? m.editedAt.toISOString() : null,
        deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
        attachments: m.deletedAt ? [] : atts,
      };
    });
    // Ascending for easier render.
    return mapped.reverse();
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        body: z.string().max(8000).optional(),
        attachments: z
          .array(
            z.object({
              storagePath: z.string().min(1),
              mime: z.string().min(1).max(120),
              width: z.number().int().positive().optional(),
              height: z.number().int().positive().optional(),
            }),
          )
          .max(10)
          .optional(),
      })
      .refine(
        (d) =>
          (d.body && d.body.trim().length > 0) || (d.attachments && d.attachments.length > 0),
        { message: "Tom melding" },
      )
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ChatMessage> => {
    const { userId } = context;
    const trimmed = data.body?.trim() ?? "";

    // --- Authorization (ported from the old msg_insert RLS WITH CHECK) ---
    if (!(await isConversationMember(data.conversationId, userId))) {
      throw new Error("Du er ikke medlem av denne samtalen.");
    }
    const convRows = await db
      .select({
        id: conversations.id,
        isGroup: conversations.isGroup,
        isRequest: conversations.isRequest,
        createdBy: conversations.createdBy,
      })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new Error("Samtale finnes ikke");

    if (!conv.isGroup) {
      // 1:1: must satisfy can_dm with the other active participant.
      const others = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, data.conversationId),
            ne(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      const other = others[0]?.userId;
      if (other && !(await canDm(userId, other))) {
        throw new Error("Du kan ikke sende melding til denne brukeren");
      }
    }

    // Request initiator may send only one message until the recipient accepts.
    if (conv.isRequest && conv.createdBy === userId) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.conversationId, data.conversationId), eq(messages.senderId, userId)));
      if ((count ?? 0) > 0) throw new Error("Vent til mottaker godtar forespørselen");
    }

    // Recipient (not initiator) replying auto-accepts the request.
    if (conv.isRequest && conv.createdBy !== userId) {
      await db
        .update(conversations)
        .set({ isRequest: false })
        .where(eq(conversations.id, data.conversationId));
    }

    // --- Insert + bump conversation (old bump_conversation_last_message trigger) ---
    const [msg] = await db
      .insert(messages)
      .values({
        conversationId: data.conversationId,
        senderId: userId,
        body: trimmed.length ? trimmed : null,
      })
      .returning({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
      });
    await bumpConversation(data.conversationId, msg.createdAt);

    let attachments: ChatMessage["attachments"] = [];
    if (data.attachments?.length) {
      const inserted = await db
        .insert(messageAttachments)
        .values(
          data.attachments.map((a) => ({
            messageId: msg.id,
            storagePath: a.storagePath,
            mime: a.mime,
            width: a.width ?? null,
            height: a.height ?? null,
          })),
        )
        .returning({
          id: messageAttachments.id,
          storagePath: messageAttachments.storagePath,
          mime: messageAttachments.mime,
          width: messageAttachments.width,
          height: messageAttachments.height,
        });
      const signed = await presignDownloadMany(inserted.map((a) => a.storagePath), MEDIA_TTL);
      attachments = inserted.map((a) => ({
        id: a.id,
        url: signed[a.storagePath] ?? "",
        mime: a.mime,
        width: a.width,
        height: a.height,
      }));
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
      editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
      deletedAt: msg.deletedAt ? msg.deletedAt.toISOString() : null,
      attachments,
    };
  });

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, data.conversationId),
          eq(conversationParticipants.userId, context.userId),
        ),
      );
    return { ok: true };
  });
