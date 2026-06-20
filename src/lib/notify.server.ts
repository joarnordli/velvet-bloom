import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, posts } from "@/db/schema";

/**
 * Notification side-effects, ported from the old Supabase AFTER-INSERT/DELETE
 * triggers (notify_on_like / unnotify_on_unlike / notify_on_comment /
 * notify_on_repost / notify_on_follow). Triggers don't exist on the self-hosted
 * DB by design — the data-layer functions call these explicitly right after the
 * mutation that warrants them. All are best-effort and self-skip when actor ==
 * recipient. See docs/migration-to-self-hosted.md §3.
 */

async function postAuthor(postId: string): Promise<string | null> {
  const r = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  return r[0]?.authorId ?? null;
}

/** A like was added: notify the post author (unless they liked their own post). */
export async function notifyLike(postId: string, actorId: string): Promise<void> {
  const author = await postAuthor(postId);
  if (!author || author === actorId) return;
  await db.insert(notifications).values({
    recipientId: author,
    actorId,
    type: "like",
    postId,
  });
}

/** A like was removed: drop the matching like notification. */
export async function unnotifyLike(postId: string, actorId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.type, "like"),
        eq(notifications.postId, postId),
        eq(notifications.actorId, actorId),
      ),
    );
}

/** A comment was added: notify the post author with a 140-char preview. */
export async function notifyComment(
  postId: string,
  commentId: string,
  actorId: string,
  body: string,
): Promise<void> {
  const author = await postAuthor(postId);
  if (!author || author === actorId) return;
  await db.insert(notifications).values({
    recipientId: author,
    actorId,
    type: "comment",
    postId,
    commentId,
    preview: body.slice(0, 140),
  });
}

/** A repost was created: notify the original author (quote preview if any). */
export async function notifyRepost(
  originalId: string,
  actorId: string,
  body: string,
): Promise<void> {
  const author = await postAuthor(originalId);
  if (!author || author === actorId) return;
  const trimmed = body.trim();
  await db.insert(notifications).values({
    recipientId: author,
    actorId,
    type: "repost",
    postId: originalId,
    preview: trimmed.length > 0 ? trimmed.slice(0, 140) : null,
  });
}

/** Generic actor→recipient notification with no post context (follow flows). */
export async function notifySimple(
  recipientId: string,
  actorId: string,
  type: "follow" | "follow_request" | "follow_accept",
): Promise<void> {
  if (recipientId === actorId) return;
  await db.insert(notifications).values({ recipientId, actorId, type });
}

/** Remove a pending follow_request notification (on accept/reject/cancel). */
export async function unnotifyFollowRequest(
  recipientId: string,
  actorId: string,
): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        eq(notifications.actorId, actorId),
        eq(notifications.type, "follow_request"),
      ),
    );
}
