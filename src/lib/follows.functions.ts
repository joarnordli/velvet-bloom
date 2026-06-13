import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const usernameInput = z.object({ username: z.string().trim().min(1).max(60) });
const idInput = z.object({ requesterId: z.string().uuid() });

async function resolveUserId(
  supabase: SupabaseClient,
  username: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function isPrivate(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_account_private", { _user: userId });
  if (error) return false;
  return !!data;
}


export type FollowResult = { status: "following" | "requested" };

export const followUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<FollowResult> => {
    const { supabase, userId } = context;
    const targetId = await resolveUserId(supabase, data.username);
    if (!targetId) throw new Error("Bruker finnes ikke");
    if (targetId === userId) throw new Error("Du kan ikke følge deg selv");

    // Already following?
    const { data: existing } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", userId)
      .eq("following_id", targetId)
      .maybeSingle();
    if (existing) return { status: "following" };

    if (await isPrivate(supabase, targetId)) {
      const { error } = await supabase
        .from("follow_requests")
        .upsert(
          { requester_id: userId, target_id: targetId },
          { onConflict: "requester_id,target_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);

      // Emit notification (best-effort)
      await supabase.from("notifications").insert({
        recipient_id: targetId,
        actor_id: userId,
        type: "follow_request",
      });

      return { status: "requested" };
    }

    const { error } = await supabase
      .from("follows")
      .upsert(
        { follower_id: userId, following_id: targetId },
        { onConflict: "follower_id,following_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { status: "following" };
  });

export const unfollowUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }): Promise<{ following: false }> => {
    const { supabase, userId } = context;
    const targetId = await resolveUserId(supabase, data.username);
    if (!targetId) return { following: false };

    // Cancel any pending request and any active follow
    await supabase
      .from("follow_requests")
      .delete()
      .eq("requester_id", userId)
      .eq("target_id", targetId);
    // Remove the request notification, if still unread/visible
    await supabase
      .from("notifications")
      .delete()
      .eq("recipient_id", targetId)
      .eq("actor_id", userId)
      .eq("type", "follow_request");

    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", userId)
      .eq("following_id", targetId);
    if (error) throw new Error(error.message);
    return { following: false };
  });

export type IncomingFollowRequest = {
  requesterId: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
};

export const listIncomingFollowRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IncomingFollowRequest[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("follow_requests")
      .select("requester_id, created_at")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const ids = rows.map((r) => r.requester_id);
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, avatar_path")
      .in("id", ids);

    const paths = (profs ?? [])
      .map((p) => p.avatar_path)
      .filter((p): p is string => !!p);
    const signed: Record<string, string> = {};
    if (paths.length) {
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrls(paths, 60 * 60);
      for (const i of data ?? [])
        if (i.path && i.signedUrl) signed[i.path] = i.signedUrl;
    }
    const profById = new Map((profs ?? []).map((p) => [p.id, p] as const));
    return rows.map((r) => {
      const p = profById.get(r.requester_id);
      return {
        requesterId: r.requester_id,
        username: p?.username ?? "ukjent",
        avatarUrl: p?.avatar_path ? signed[p.avatar_path] ?? null : null,
        createdAt: r.created_at,
      };
    });
  });

export const acceptFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Validate request exists targeting me
    const { data: row } = await supabase
      .from("follow_requests")
      .select("requester_id")
      .eq("requester_id", data.requesterId)
      .eq("target_id", userId)
      .maybeSingle();
    if (!row) throw new Error("Forespørsel finnes ikke");

    const { error: insErr } = await supabase
      .from("follows")
      .upsert(
        { follower_id: data.requesterId, following_id: userId },
        { onConflict: "follower_id,following_id", ignoreDuplicates: true },
      );
    if (insErr) throw new Error(insErr.message);

    await supabase
      .from("follow_requests")
      .delete()
      .eq("requester_id", data.requesterId)
      .eq("target_id", userId);

    // Clean up the request notification on my side
    await supabase
      .from("notifications")
      .delete()
      .eq("recipient_id", userId)
      .eq("actor_id", data.requesterId)
      .eq("type", "follow_request");

    // Notify requester we accepted
    await supabase.from("notifications").insert({
      recipient_id: data.requesterId,
      actor_id: userId,
      type: "follow_accept",
    });

    return { ok: true };
  });

export const rejectFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("follow_requests")
      .delete()
      .eq("requester_id", data.requesterId)
      .eq("target_id", userId);
    await supabase
      .from("notifications")
      .delete()
      .eq("recipient_id", userId)
      .eq("actor_id", data.requesterId)
      .eq("type", "follow_request");
    return { ok: true };
  });

export const cancelFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const targetId = await resolveUserId(supabase, data.username);
    if (!targetId) return { ok: true };
    await supabase
      .from("follow_requests")
      .delete()
      .eq("requester_id", userId)
      .eq("target_id", targetId);
    await supabase
      .from("notifications")
      .delete()
      .eq("recipient_id", targetId)
      .eq("actor_id", userId)
      .eq("type", "follow_request");
    return { ok: true };
  });
