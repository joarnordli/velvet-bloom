import type { QueryClient } from "@tanstack/react-query";
import type { FeedPost } from "./posts.functions";

type CommentLite = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string };
};

type CommentListResult = {
  currentUserId: string;
  comments: CommentLite[];
};

function isFeedPost(v: unknown): v is FeedPost {
  return !!v && typeof v === "object" && "id" in (v as object) && "likeCount" in (v as object);
}
function isFeedPostArray(v: unknown): v is FeedPost[] {
  return Array.isArray(v) && (v.length === 0 || isFeedPost(v[0]));
}
type InfiniteFeed = { pages: Array<{ posts: FeedPost[] }> };
function isInfiniteFeed(v: unknown): v is InfiniteFeed {
  if (!v || typeof v !== "object") return false;
  const pages = (v as { pages?: unknown }).pages;
  return (
    Array.isArray(pages) &&
    pages.every(
      (pg) => !!pg && typeof pg === "object" && Array.isArray((pg as { posts?: unknown }).posts),
    )
  );
}

/**
 * Patch every cached FeedPost that matches `matcher` across all queries.
 * Works on caches that hold `FeedPost`, `FeedPost[]`, or `FeedPost | null`.
 */
export function patchPosts(
  qc: QueryClient,
  matcher: (p: FeedPost) => boolean,
  patch: (p: FeedPost) => FeedPost,
) {
  const entries = qc.getQueriesData<unknown>({});
  for (const [key, data] of entries) {
    if (data == null) continue;
    if (isInfiniteFeed(data)) {
      let changed = false;
      const pages = data.pages.map((page) => {
        let pageChanged = false;
        const posts = page.posts.map((p) => {
          if (matcher(p)) {
            pageChanged = true;
            changed = true;
            return patch(p);
          }
          return p;
        });
        return pageChanged ? { ...page, posts } : page;
      });
      if (changed) qc.setQueryData(key, { ...data, pages });
    } else if (isFeedPostArray(data)) {
      let changed = false;
      const next = data.map((p) => {
        if (matcher(p)) {
          changed = true;
          return patch(p);
        }
        return p;
      });
      if (changed) qc.setQueryData(key, next);
    } else if (isFeedPost(data)) {
      if (matcher(data)) qc.setQueryData(key, patch(data));
    }
  }
}

/** Remove a post entirely from any cache that holds it (delete). */
export function removePost(qc: QueryClient, postId: string) {
  const entries = qc.getQueriesData<unknown>({});
  for (const [key, data] of entries) {
    if (data == null) continue;
    if (isInfiniteFeed(data)) {
      let changed = false;
      const pages = data.pages.map((page) => {
        const posts = page.posts.filter((p) => p.id !== postId);
        if (posts.length !== page.posts.length) {
          changed = true;
          return { ...page, posts };
        }
        return page;
      });
      if (changed) qc.setQueryData(key, { ...data, pages });
    } else if (isFeedPostArray(data)) {
      const next = data.filter((p) => p.id !== postId);
      if (next.length !== data.length) qc.setQueryData(key, next);
    } else if (isFeedPost(data) && data.id === postId) {
      qc.setQueryData(key, null);
    }
  }
}

/** Patch comment-count on the canonical original (and any card whose repostOf points to it). */
export function bumpCommentCount(qc: QueryClient, originalId: string, delta: number) {
  patchPosts(
    qc,
    (p) => p.id === originalId || p.repostOf?.id === originalId,
    (p) => ({ ...p, commentCount: Math.max(0, p.commentCount + delta) }),
  );
}

/** Patch repost-count + repostedByMe across all cards sharing the same canonical original. */
export function setRepostState(
  qc: QueryClient,
  originalId: string,
  repostedByMe: boolean,
  delta: number,
) {
  patchPosts(
    qc,
    (p) => p.id === originalId || p.repostOf?.id === originalId,
    (p) => ({
      ...p,
      repostedByMe,
      repostCount: Math.max(0, p.repostCount + delta),
    }),
  );
}

/** Patch like state across all cards sharing the same canonical original. */
export function setLikeState(
  qc: QueryClient,
  originalId: string,
  likedByMe: boolean,
  delta: number,
) {
  patchPosts(
    qc,
    (p) => p.id === originalId || p.repostOf?.id === originalId,
    (p) => ({
      ...p,
      likedByMe,
      likeCount: Math.max(0, p.likeCount + delta),
    }),
  );
}

/** Update body of a post in every cache that holds it. */
export function patchPostBody(qc: QueryClient, postId: string, body: string) {
  patchPosts(qc, (p) => p.id === postId, (p) => ({ ...p, body }));
}

/* ---------------- Comments helpers ---------------- */

function isCommentResult(v: unknown): v is CommentListResult {
  return !!v && typeof v === "object" && "comments" in (v as object) && "currentUserId" in (v as object);
}

export function addCommentToCache(qc: QueryClient, postId: string, comment: CommentLite) {
  const key = ["comments", postId];
  const prev = qc.getQueryData<CommentListResult>(key);
  if (!prev) return;
  qc.setQueryData(key, { ...prev, comments: [...prev.comments, comment] });
}

export function replaceCommentInCache(
  qc: QueryClient,
  postId: string,
  tempId: string,
  real: CommentLite,
) {
  const key = ["comments", postId];
  const prev = qc.getQueryData<CommentListResult>(key);
  if (!prev) return;
  qc.setQueryData(key, {
    ...prev,
    comments: prev.comments.map((c) => (c.id === tempId ? real : c)),
  });
}

export function removeCommentFromCache(qc: QueryClient, postId: string, commentId: string) {
  const key = ["comments", postId];
  const prev = qc.getQueryData<CommentListResult>(key);
  if (!prev) return;
  qc.setQueryData(key, {
    ...prev,
    comments: prev.comments.filter((c) => c.id !== commentId),
  });
}

export { isCommentResult };
export type { CommentLite, CommentListResult };
