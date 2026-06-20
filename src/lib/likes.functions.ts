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
      await db
        .delete(postLikes)
        .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId)));
      await unnotifyLike(data.postId, userId);
    } else {
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
      await db.insert(postLikes).values({ postId: data.postId, userId }).onConflictDoNothing();
      await notifyLike(data.postId, userId);
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postLikes)
      .where(eq(postLikes.postId, data.postId));

    return { liked: existing.length === 0, likeCount: count ?? 0 };
  });
