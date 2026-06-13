import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  participants: Array<{
    id: string;
    username: string;
    avatarUrl: string | null;
    isMe: boolean;
  }>;
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

// ===== Helpers =====

async function signAvatar(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60 * 60 * 24);
  return data?.signedUrl ?? null;
}

async function signAttachment(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  const { data } = await supabase.storage
    .from("message-media")
    .createSignedUrl(path, 60 * 60 * 24);
  return data?.signedUrl ?? "";
}


// ===== Server fns =====

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ tab: z.enum(["chats", "requests"]).default("chats") })
      .parse(data ?? {}),
  )
  .handler(
    async ({ data, context }): Promise<ConversationListItem[]> => {
      const { supabase, userId } = context;
      const tab = data.tab;

    // 1. Active memberships for me with last_read_at + pinned_at
    const { data: myParts, error: mErr } = await supabase
      .from("conversation_participants")
      .select("conversation_id, last_read_at, left_at, pinned_at")
      .eq("user_id", userId)
      .is("left_at", null);
    if (mErr) throw new Error(mErr.message);
    if (!myParts?.length) return [];

    const convIds = myParts.map((p) => p.conversation_id);
    const lastReadById = new Map<string, string>(
      myParts.map((p) => [p.conversation_id, p.last_read_at]),
    );
    const pinnedById = new Map<string, string | null>(
      myParts.map((p) => [p.conversation_id, p.pinned_at ?? null]),
    );

    // 2. Conversations (include is_request + created_by for tab filtering)
    const { data: convs, error: cErr } = await supabase
      .from("conversations")
      .select("id, is_group, title, last_message_at, is_request, created_by")
      .in("id", convIds)
      .order("last_message_at", { ascending: false });
    if (cErr) throw new Error(cErr.message);

    // 3. All participants for these conversations (with profile data)
    const { data: parts, error: pErr } = await supabase
      .from("conversation_participants")
      .select("conversation_id, user_id, left_at")
      .in("conversation_id", convIds);
    if (pErr) throw new Error(pErr.message);

    const allActiveUserIds = Array.from(
      new Set(
        (parts ?? [])
          .filter((p) => p.left_at === null)
          .map((p) => p.user_id),
      ),
    );

    const profileById = new Map<
      string,
      { id: string; username: string; avatar_path: string | null }
    >();
    if (allActiveUserIds.length) {
      const { data: profiles, error: prErr } = await supabase
        .from("profiles")
        .select("id, username, avatar_path")
        .in("id", allActiveUserIds);
      if (prErr) throw new Error(prErr.message);
      for (const p of profiles ?? []) profileById.set(p.id, p);
    }

    // sign avatars in parallel
    const signedAvatars = new Map<string, string | null>();
    await Promise.all(
      Array.from(profileById.values()).map(async (p) => {
        signedAvatars.set(p.id, await signAvatar(supabase, p.avatar_path));
      }),
    );

    // 4. Last message per conversation — ONE query, pick first per conv in JS
    const { data: recentMsgs, error: lmErr } = await supabase
      .from("messages")
      .select(
        "id, conversation_id, sender_id, body, created_at, message_attachments(id)",
      )
      .in("conversation_id", convIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(convIds.length * 4); // small buffer so each conv likely has its newest
    if (lmErr) throw new Error(lmErr.message);

    const lastMsgByConv = new Map<
      string,
      NonNullable<typeof recentMsgs>[number]
    >();
    for (const m of recentMsgs ?? []) {
      if (!lastMsgByConv.has(m.conversation_id)) {
        lastMsgByConv.set(m.conversation_id, m);
      }
    }

    // Fallback: any conv we didn't catch in the bulk fetch — fetch individually
    const missingConvs = convIds.filter((cid) => !lastMsgByConv.has(cid));
    if (missingConvs.length) {
      await Promise.all(
        missingConvs.map(async (cid) => {
          const { data } = await supabase
            .from("messages")
            .select(
              "id, conversation_id, sender_id, body, created_at, message_attachments(id)",
            )
            .eq("conversation_id", cid)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data) lastMsgByConv.set(cid, data);
        }),
      );
    }


    // 5. Unread count per conversation (messages after last_read_at, not from me)
    const unreadCounts = await Promise.all(
      convIds.map(async (cid) => {
        const after = lastReadById.get(cid) ?? new Date(0).toISOString();
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", cid)
          .gt("created_at", after)
          .neq("sender_id", userId)
          .is("deleted_at", null);
        return [cid, count ?? 0] as const;
      }),
    );
    const unreadByConv = new Map(unreadCounts);

    const items = (convs ?? [])
      .filter((c) => {
        const isReq = !!c.is_request;
        if (tab === "requests") {
          // Requests tab: only requests where I'm the recipient (not initiator)
          return isReq && c.created_by !== userId;
        }
        // Chats tab: everything else — accepted convos, plus my own outgoing requests
        return !isReq || c.created_by === userId;
      })
      .map((c) => {
        const convParts = (parts ?? []).filter(
          (p) => p.conversation_id === c.id && p.left_at === null,
        );
        const participantList = convParts.map((p) => {
          const prof = profileById.get(p.user_id);
          return {
            id: p.user_id,
            username: prof?.username ?? "ukjent",
            avatarUrl: signedAvatars.get(p.user_id) ?? null,
            isMe: p.user_id === userId,
          };
        });
        const lm = lastMsgByConv.get(c.id);
        return {
          id: c.id,
          isGroup: c.is_group,
          isRequest: !!c.is_request,
          isMyRequest: !!c.is_request && c.created_by === userId,
          title: c.title,
          lastMessageAt: c.last_message_at,
          lastReadAt: lastReadById.get(c.id) ?? new Date(0).toISOString(),
          pinnedAt: pinnedById.get(c.id) ?? null,
          unreadCount: unreadByConv.get(c.id) ?? 0,
          lastMessage: lm
            ? {
                body: lm.body,
                senderId: lm.sender_id,
                createdAt: lm.created_at,
                hasAttachment: Array.isArray(lm.message_attachments)
                  ? lm.message_attachments.length > 0
                  : false,
              }
            : null,
          participants: participantList,
        };
      });

    // sort: pinned first (by pinnedAt desc), then by lastMessageAt desc
    items.sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      if (a.pinnedAt && b.pinnedAt) {
        return a.pinnedAt < b.pinnedAt ? 1 : -1;
      }
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    });

    return items;
  });

export const setConversationPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ conversationId: z.string().uuid(), pinned: z.boolean() })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_participants")
      .update({ pinned_at: data.pinned ? new Date().toISOString() : null })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getOrCreateDm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ username: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ conversationId: string; status: "allowed" | "request" }> => {
      const { supabase, userId } = context;
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", data.username)
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);
      if (!prof) throw new Error("Bruker finnes ikke");

      // Check status server-side
      const { data: statusData } = await supabase.rpc("dm_status", {
        _sender: userId,
        _recipient: prof.id,
      });
      const status = (statusData ?? "blocked") as "allowed" | "request" | "blocked";
      if (status === "blocked") {
        throw new Error("Denne brukeren tar ikke imot meldinger fra deg");
      }

      const { data: convId, error } = await supabase.rpc("get_or_create_dm", {
        _other: prof.id,
      });
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("not allowed"))
          throw new Error("Denne brukeren tar ikke imot meldinger fra deg");
        throw new Error(error.message);
      }

      // If this is a fresh request conversation we initiated, mark it.
      if (status === "request") {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", convId as string);
        if ((count ?? 0) === 0) {
          await supabase
            .from("conversations")
            .update({ is_request: true })
            .eq("id", convId as string)
            .eq("created_by", userId);
        }
      }

      return { conversationId: convId as string, status: status as "allowed" | "request" };
    },
  );

export const getDmStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ username: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "allowed" | "request" | "blocked" }> => {
      const { supabase, userId } = context;
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", data.username)
        .maybeSingle();
      if (!prof) return { status: "blocked" };
      if (prof.id === userId) return { status: "allowed" };
      const { data: s } = await supabase.rpc("dm_status", {
        _sender: userId,
        _recipient: prof.id,
      });
      return { status: (s ?? "blocked") as "allowed" | "request" | "blocked" };
    },
  );

export const acceptMessageRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Validate I'm the recipient
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, is_request, created_by")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv) throw new Error("Samtale finnes ikke");
    if (!conv.is_request) return { ok: true };
    if (conv.created_by === userId)
      throw new Error("Du kan ikke godta din egen forespørsel");
    const { error } = await supabase
      .from("conversations")
      .update({ is_request: false })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const declineMessageRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });



export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<ConversationDetail> => {
    const { supabase, userId } = context;
    const { data: conv, error: cErr } = await supabase
      .from("conversations")
      .select("id, is_group, title, is_request, created_by")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!conv) throw notFound();

    const { data: parts, error: pErr } = await supabase
      .from("conversation_participants")
      .select("user_id, last_read_at, left_at")
      .eq("conversation_id", data.conversationId);
    if (pErr) throw new Error(pErr.message);

    const userIds = (parts ?? []).map((p) => p.user_id);
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, avatar_path")
      .in("id", userIds);

    const profById = new Map((profs ?? []).map((p) => [p.id, p]));
    const signed = new Map<string, string | null>();
    await Promise.all(
      (profs ?? []).map(async (p) => {
        signed.set(p.id, await signAvatar(supabase, p.avatar_path));
      }),
    );

    return {
      id: conv.id,
      isGroup: conv.is_group,
      isRequest: !!conv.is_request,
      isMyRequest: !!conv.is_request && conv.created_by === userId,
      title: conv.title,
      participants: (parts ?? []).map((p) => {
        const prof = profById.get(p.user_id);
        return {
          id: p.user_id,
          username: prof?.username ?? "ukjent",
          avatarUrl: signed.get(p.user_id) ?? null,
          lastReadAt: p.last_read_at,
          isMe: p.user_id === userId,
          leftAt: p.left_at,
        };
      }),
    };
  });

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabase } = context;
    let q = supabase
      .from("messages")
      .select(
        "id, conversation_id, sender_id, body, created_at, edited_at, deleted_at, message_attachments(id, storage_path, mime, width, height)",
      )
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.before) q = q.lt("created_at", data.before);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const mapped = await Promise.all(
      (rows ?? []).map(async (m): Promise<ChatMessage> => {
        const atts = await Promise.all(
          (m.message_attachments ?? []).map(async (a) => ({
            id: a.id,
            url: await signAttachment(supabase, a.storage_path),
            mime: a.mime,
            width: a.width,
            height: a.height,
          })),
        );
        return {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          body: m.deleted_at ? null : m.body,
          createdAt: m.created_at,
          editedAt: m.edited_at,
          deletedAt: m.deleted_at,
          attachments: m.deleted_at ? [] : atts,
        };
      }),
    );
    // return ascending for easier render
    return mapped.reverse();
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
      .refine((d) => (d.body && d.body.trim().length > 0) || (d.attachments && d.attachments.length > 0), {
        message: "Tom melding",
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ChatMessage> => {
    const { supabase, userId } = context;
    const trimmed = data.body?.trim() ?? "";

    // If conversation is in request state and the recipient (not the
    // initiator) is sending, auto-accept the request before the message lands.
    const { data: convRow } = await supabase
      .from("conversations")
      .select("id, is_request, created_by")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convRow?.is_request && convRow.created_by !== userId) {
      await supabase
        .from("conversations")
        .update({ is_request: false })
        .eq("id", data.conversationId);
    }

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        body: trimmed.length ? trimmed : null,
      })
      .select("id, conversation_id, sender_id, body, created_at, edited_at, deleted_at")
      .single();
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("row-level security") || m.includes("violates"))
        throw new Error(
          convRow?.is_request && convRow.created_by === userId
            ? "Vent til mottaker godtar forespørselen"
            : "Du kan ikke sende melding til denne brukeren",
        );
      throw new Error(error.message);
    }

    let attachments: ChatMessage["attachments"] = [];
    if (data.attachments?.length) {
      const rows = data.attachments.map((a) => ({
        message_id: msg.id,
        storage_path: a.storagePath,
        mime: a.mime,
        width: a.width ?? null,
        height: a.height ?? null,
      }));
      const { data: inserted, error: aErr } = await supabase
        .from("message_attachments")
        .insert(rows)
        .select("id, storage_path, mime, width, height");
      if (aErr) throw new Error(aErr.message);
      attachments = await Promise.all(
        (inserted ?? []).map(async (a) => ({
          id: a.id,
          url: await signAttachment(supabase, a.storage_path),
          mime: a.mime,
          width: a.width,
          height: a.height,
        })),
      );
    }

    return {
      id: msg.id,
      conversationId: msg.conversation_id,
      senderId: msg.sender_id,
      body: msg.body,
      createdAt: msg.created_at,
      editedAt: msg.edited_at,
      deletedAt: msg.deleted_at,
      attachments,
    };
  });

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
