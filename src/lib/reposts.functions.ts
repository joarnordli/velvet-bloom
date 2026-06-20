import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { canEngage } from "./authz.server";
import { notifyRepost } from "./notify.server";

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
  .middleware([requireAuth])
  .inputValidator((data: unknown) => repostInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Resolve the canonical original: never repost a repost.
    const target = await db
      .select({ id: posts.id, repostOf: posts.repostOf, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, data.postId))
      .limit(1);
    if (!target.length) throw new Error("Post not found");
    const originalId = target[0].repostOf ?? target[0].id;

    // Engagement gate against the original author (old RLS WITH CHECK).
    const original = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, originalId))
      .limit(1);
    const originalAuthor = original[0]?.authorId;
    if (originalAuthor && !(await canEngage(userId, originalAuthor))) {
      throw new Error("Du kan ikke reposte denne posten.");
    }

    const caption = (data.caption ?? "").trim();

    if (!caption) {
      // De-dupe plain repost — one per user per original.
      const existing = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.authorId, userId),
            eq(posts.repostOf, originalId),
            eq(posts.body, ""),
          ),
        )
        .limit(1);
      if (existing.length) return { ok: true, id: existing[0].id };
    }

    const [inserted] = await db
      .insert(posts)
      .values({ authorId: userId, body: caption, imagePath: null, repostOf: originalId })
      .returning({ id: posts.id });
    await db
      .update(posts)
      .set({ repostCount: sql`${posts.repostCount} + 1` })
      .where(eq(posts.id, originalId));
    await notifyRepost(originalId, userId, caption);
    return { ok: true, id: inserted.id };
  });

const undoInput = z.object({ postId: z.string().uuid() });

/** Remove the current user's plain repost of a given post. */
export const undoRepost = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => undoInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const target = await db
      .select({ id: posts.id, repostOf: posts.repostOf })
      .from(posts)
      .where(eq(posts.id, data.postId))
      .limit(1);
    if (!target.length) return { ok: true, removed: 0 };
    const originalId = target[0].repostOf ?? target[0].id;
    const deleted = await db
      .delete(posts)
      .where(
        and(
          eq(posts.authorId, userId),
          eq(posts.repostOf, originalId),
          eq(posts.body, ""),
        ),
      )
      .returning({ id: posts.id });
    if (deleted.length) {
      await db
        .update(posts)
        .set({ repostCount: sql`GREATEST(${posts.repostCount} - ${deleted.length}, 0)` })
        .where(eq(posts.id, originalId));
    }
    return { ok: true, removed: deleted.length };
  });
