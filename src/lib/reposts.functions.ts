import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const repostInput = z.object({
  postId: z.string().uuid(),
  caption: z.string().trim().max(500).optional(),
});

/**
 * Create a repost of an existing post. If caption is empty, it's a plain
 * repost; otherwise it's a quote-repost. Plain reposts are de-duplicated
 * per user (one undo-able repost per post).
 */
export const repostPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => repostInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve the canonical original: never repost a repost.
    const { data: target, error: targetErr } = await supabase
      .from("posts")
      .select("id, repost_of")
      .eq("id", data.postId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!target) throw new Error("Post not found");
    const originalId = target.repost_of ?? target.id;

    const caption = (data.caption ?? "").trim();

    if (!caption) {
      // De-dupe plain repost — one per user per original.
      const { data: existing } = await supabase
        .from("posts")
        .select("id")
        .eq("author_id", userId)
        .eq("repost_of", originalId)
        .eq("body", "")
        .maybeSingle();
      if (existing) return { ok: true, id: existing.id };
    }

    const { data: inserted, error } = await supabase
      .from("posts")
      .insert({
        author_id: userId,
        body: caption,
        image_path: null,
        repost_of: originalId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

const undoInput = z.object({ postId: z.string().uuid() });

/** Remove the current user's plain repost of a given post. */
export const undoRepost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => undoInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: target } = await supabase
      .from("posts")
      .select("id, repost_of")
      .eq("id", data.postId)
      .maybeSingle();
    if (!target) return { ok: true, removed: 0 };
    const originalId = target.repost_of ?? target.id;
    const { data: deleted, error } = await supabase
      .from("posts")
      .delete()
      .eq("author_id", userId)
      .eq("repost_of", originalId)
      .eq("body", "")
      .select("id");
    if (error) throw new Error(error.message);
    return { ok: true, removed: deleted?.length ?? 0 };
  });
