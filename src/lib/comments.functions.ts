import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { postComments, posts, profiles } from "@/db/schema";
import { requireAuth } from "./auth-middleware";
import { canEngage } from "./authz.server";
import { notifyComment } from "./notify.server";

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
  .middleware([requireAuth])
  .inputValidator((data: unknown) => listInput.parse(data))
  .handler(async ({ data, context }): Promise<CommentListResult> => {
    const { userId } = context;
    const list = await db
      .select({
        id: postComments.id,
        body: postComments.body,
        createdAt: postComments.createdAt,
        authorId: postComments.authorId,
      })
      .from(postComments)
      .where(eq(postComments.postId, data.postId))
      .orderBy(asc(postComments.createdAt))
      .limit(500);

    if (!list.length) return { currentUserId: userId, comments: [] };

    const ids = Array.from(new Set(list.map((r) => r.authorId)));
    const profs = await db
      .select({ id: profiles.id, username: profiles.username })
      .from(profiles)
      .where(inArray(profiles.id, ids));
    const names: Record<string, string> = {};
    for (const p of profs) names[p.id] = p.username;

    return {
      currentUserId: userId,
      comments: list.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        author: { id: r.authorId, username: names[r.authorId] ?? "ukjent" },
      })),
    };
  });

const addInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => addInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Engagement gate (old RLS WITH CHECK can_engage on the post author).
    const author = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, data.postId))
      .limit(1);
    const authorId = author[0]?.authorId;
    if (!authorId) throw new Error("Posten finnes ikke.");
    if (!(await canEngage(userId, authorId))) {
      throw new Error("Du kan ikke kommentere denne posten.");
    }

    const [row] = await db
      .insert(postComments)
      .values({ postId: data.postId, authorId: userId, body: data.body })
      .returning({ id: postComments.id });
    await notifyComment(data.postId, row.id, userId, data.body);
    return { ok: true };
  });

const deleteInput = z.object({ commentId: z.string().uuid() });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await db
      .delete(postComments)
      .where(and(eq(postComments.id, data.commentId), eq(postComments.authorId, userId)));
    return { ok: true };
  });
