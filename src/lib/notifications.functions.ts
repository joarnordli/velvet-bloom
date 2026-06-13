import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationItem[]> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("notifications")
      .select("id, type, created_at, read_at, preview, actor_id, post_id")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const actorIds = Array.from(new Set(rows.map((r) => r.actor_id)));
    const postIds = Array.from(
      new Set(rows.map((r) => r.post_id).filter((v): v is string => !!v)),
    );

    const [{ data: profiles }, { data: posts }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, avatar_path")
        .in("id", actorIds),
      postIds.length
        ? supabase
            .from("posts")
            .select("id, body, image_path")
            .in("id", postIds)
        : Promise.resolve({ data: [] as Array<{ id: string; body: string; image_path: string | null }> }),
    ]);

    const avatarPaths = (profiles ?? [])
      .map((p) => p.avatar_path)
      .filter((p): p is string => !!p);
    const imagePaths = (posts ?? [])
      .map((p) => p.image_path)
      .filter((p): p is string => !!p);

    const signedAvatars: Record<string, string> = {};
    if (avatarPaths.length) {
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrls(avatarPaths, 60 * 60);
      for (const i of data ?? [])
        if (i.path && i.signedUrl) signedAvatars[i.path] = i.signedUrl;
    }
    const signedImages: Record<string, string> = {};
    if (imagePaths.length) {
      const { data } = await supabase.storage
        .from("post-media")
        .createSignedUrls(imagePaths, 60 * 60);
      for (const i of data ?? [])
        if (i.path && i.signedUrl) signedImages[i.path] = i.signedUrl;
    }

    const profileById = new Map(
      (profiles ?? []).map((p) => [p.id, p] as const),
    );
    const postById = new Map((posts ?? []).map((p) => [p.id, p] as const));

    return rows.map((r) => {
      const prof = profileById.get(r.actor_id);
      const post = r.post_id ? postById.get(r.post_id) : undefined;
      return {
        id: r.id,
        type: r.type as NotificationType,
        createdAt: r.created_at,
        readAt: r.read_at,
        preview: r.preview,
        actor: {
          id: r.actor_id,
          username: prof?.username ?? "ukjent",
          avatarUrl: prof?.avatar_path
            ? signedAvatars[prof.avatar_path] ?? null
            : null,
        },
        post: post
          ? {
              id: post.id,
              body: post.body,
              imageUrl: post.image_path
                ? signedImages[post.image_path] ?? null
                : null,
            }
          : null,
      };
    });
  });

export const getUnreadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      notifications: number;
      messages: number;
      messageRequests: number;
    }> => {
      const { supabase, userId } = context;

      const { count: notifCount } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .is("read_at", null);

      // Messages unread, split by whether conversation is a request
      const { data: parts } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId)
        .is("left_at", null);

      // Conversations the user is in, with request flag
      const convIds = (parts ?? []).map((p) => p.conversation_id);
      const reqByConv = new Map<string, boolean>();
      if (convIds.length) {
        const { data: convs } = await supabase
          .from("conversations")
          .select("id, is_request, created_by")
          .in("id", convIds);
        for (const c of convs ?? []) {
          // Treat as request only when *I* did not initiate it.
          reqByConv.set(c.id, !!c.is_request && c.created_by !== userId);
        }
      }

      let messages = 0;
      let messageRequests = 0;
      for (const p of parts ?? []) {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", p.conversation_id)
          .gt("created_at", p.last_read_at ?? new Date(0).toISOString())
          .neq("sender_id", userId)
          .is("deleted_at", null);
        if (reqByConv.get(p.conversation_id)) messageRequests += count ?? 0;
        else messages += count ?? 0;
      }

      return {
        notifications: notifCount ?? 0,
        messages,
        messageRequests,
      };
    },
  );

const markInput = z.object({ ids: z.array(z.string().uuid()).optional() });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => markInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const q = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .is("read_at", null);
    const { error } = data.ids?.length ? await q.in("id", data.ids) : await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
