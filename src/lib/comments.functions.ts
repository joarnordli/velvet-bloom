import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string };
};

export type CommentListResult = {
  currentUserId: string;
  comments: Comment[];
};

const listInput = z.object({ postId: z.string().uuid() });

export const listComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listInput.parse(data))
  .handler(async ({ data, context }): Promise<CommentListResult> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("post_comments")
      .select("id, body, created_at, author_id")
      .eq("post_id", data.postId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (!list.length) return { currentUserId: userId, comments: [] };
    const ids = Array.from(new Set(list.map((r) => r.author_id)));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", ids);
    const names: Record<string, string> = {};
    for (const p of profs ?? []) names[p.id] = p.username;
    return {
      currentUserId: userId,
      comments: list.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        author: { id: r.author_id, username: names[r.author_id] ?? "ukjent" },
      })),
    };
  });

const addInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => addInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("post_comments").insert({
      post_id: data.postId,
      author_id: userId,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteInput = z.object({ commentId: z.string().uuid() });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("post_comments")
      .delete()
      .eq("id", data.commentId)
      .eq("author_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
