import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ postId: z.string().uuid() });

export const toggleLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<{ liked: boolean; likeCount: number }> => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", data.postId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", data.postId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("post_likes")
        .insert({ post_id: data.postId, user_id: userId });
      if (error) throw new Error(error.message);
    }

    const { count } = await supabase
      .from("post_likes")
      .select("post_id", { count: "exact", head: true })
      .eq("post_id", data.postId);

    return { liked: !existing, likeCount: count ?? 0 };
  });
