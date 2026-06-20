import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { postLikes, posts } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { canEngage } from "./authz.server";
import { notifyLike, unnotifyLike } from "./notify.server";

const input = z.object({ postId: z.string().uuid() });

export const toggleLike = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<{ liked: boolean; likeCount: number }> => {
    const { userId } = context;

    const existing = await db
      .select({ x: postLikes.userId })
      .from(postLikes)
      .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId)))
      .limit(1);

    if (existing.length > 0) {
      const removed = await db
        .delete(postLikes)
        .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId)))
        .returning({ postId: postLikes.postId });
      await unnotifyLike(data.postId, userId);
      if (!removed.length) {
        // Already gone (race) — return the current counter unchanged.
        const [row] = await db
          .select({ likeCount: posts.likeCount })
          .from(posts)
          .where(eq(posts.id, data.postId))
          .limit(1);
        return { liked: false, likeCount: row?.likeCount ?? 0 };
      }
      const [row] = await db
        .update(posts)
        .set({ likeCount: sql`GREATEST(${posts.likeCount} - 1, 0)` })
        .where(eq(posts.id, data.postId))
        .returning({ likeCount: posts.likeCount });
      return { liked: false, likeCount: row?.likeCount ?? 0 };
    }

    // Engagement gate (old RLS WITH CHECK can_engage on the post author).
    const author = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, data.postId))
      .limit(1);
    const authorId = author[0]?.authorId;
    if (!authorId) throw new Error("Posten finnes ikke.");
    if (!(await canEngage(userId, authorId))) {
      throw new Error("Du kan ikke reagere på denne posten.");
    }
    const inserted = await db
      .insert(postLikes)
      .values({ postId: data.postId, userId })
      .onConflictDoNothing()
      .returning({ postId: postLikes.postId });
    if (!inserted.length) {
      // Concurrent duplicate — counter already reflects it.
      const [row] = await db
        .select({ likeCount: posts.likeCount })
        .from(posts)
        .where(eq(posts.id, data.postId))
        .limit(1);
      return { liked: true, likeCount: row?.likeCount ?? 0 };
    }
    await notifyLike(data.postId, userId);
    const [row] = await db
      .update(posts)
      .set({ likeCount: sql`${posts.likeCount} + 1` })
      .where(eq(posts.id, data.postId))
      .returning({ likeCount: posts.likeCount });
    return { liked: true, likeCount: row?.likeCount ?? 0 };
  });
