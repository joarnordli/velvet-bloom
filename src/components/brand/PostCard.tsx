import { Heart, MessageCircle, Repeat2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { lazy, Suspense, useState, useRef, useEffect, forwardRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useDiscreetMode } from "@/context/discreet-mode";
import { useDeferredUnmount } from "@/hooks/use-deferred-unmount";
import type { FeedPost, RepostOriginal } from "@/lib/posts.functions";
import { deletePost } from "@/lib/posts.functions";
import { toggleLike } from "@/lib/likes.functions";
import { repostPost, undoRepost } from "@/lib/reposts.functions";
import {
  setLikeState,
  setRepostState,
  removePost,
} from "@/lib/post-cache";
import { FadeImage } from "./FadeImage";

const CommentDrawer = lazy(() =>
  import("./CommentDrawer").then((m) => ({ default: m.CommentDrawer })),
);
const QuoteRepostModal = lazy(() =>
  import("./QuoteRepostModal").then((m) => ({ default: m.QuoteRepostModal })),
);
const EditPostModal = lazy(() =>
  import("./EditPostModal").then((m) => ({ default: m.EditPostModal })),
);

const MENU_EASE = [0.32, 0.72, 0, 1] as const;

function audienceLockTitle(aud: "everyone" | "followers" | "mutuals" | "nobody"): string {
  switch (aud) {
    case "followers":
      return "Bare følgere kan reagere";
    case "mutuals":
      return "Bare gjensidige følgere kan reagere";
    case "nobody":
      return "Reaksjoner er slått av";
    default:
      return "";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "nå";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}t`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function EmbeddedOriginal({ original }: { original: RepostOriginal }) {
  if (original.deleted) {
    return (
      <div className="mx-4 mt-1 rounded-2xl border border-white/10 px-4 py-3 text-sm text-muted-foreground">
        Originalposten er slettet.
      </div>
    );
  }
  const authorInner = (
    <>
      <span className="h-6 w-6 rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10 inline-block">
        {original.author.avatarUrl && (
          <img
            src={original.author.avatarUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        )}
      </span>
      <span className="text-xs font-medium">{original.author.username}</span>
    </>
  );
  return (
    <Link
      to="/post/$postId"
      params={{ postId: original.id }}
      className="mx-4 mt-1 block rounded-2xl border border-white/10 hover:border-white/20 transition overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        {original.mine ? (
          <span className="flex items-center gap-2">{authorInner}</span>
        ) : (
          <Link
            to="/u/$username"
            params={{ username: original.author.username }}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 hover:underline"
          >
            {authorInner}
          </Link>
        )}
        <span className="text-[11px] text-muted-foreground">· {timeAgo(original.createdAt)}</span>
      </div>
      {original.body && (
        <p className="px-3 pt-1.5 pb-2 text-sm text-foreground/90 whitespace-pre-wrap">
          {original.body}
        </p>
      )}
      {original.imageUrl && (
        <div className="w-full aspect-[4/5] overflow-hidden bg-black/40">
          <FadeImage
            src={original.imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </Link>
  );
}

export function PostCard({ post, hideCommentButton = false }: { post: FeedPost; hideCommentButton?: boolean }) {
  const { discreet } = useDiscreetMode();
  const [drawer, setDrawer] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const repostMenuRef = useRef<HTMLDivElement | null>(null);
  const ownerMenuRef = useRef<HTMLDivElement | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const qc = useQueryClient();
  const toggle = useServerFn(toggleLike);
  const repostFn = useServerFn(repostPost);
  const undoRepostFn = useServerFn(undoRepost);
  const deleteFn = useServerFn(deletePost);

  const drawerMounted = useDeferredUnmount(drawer, 320);
  const quoteMounted = useDeferredUnmount(quoteOpen, 320);
  const editMounted = useDeferredUnmount(editOpen, 320);

  // Heart pulse — gate to skip the initial mount.
  const heartFirstRef = useRef(true);
  const [heartPulseKey, setHeartPulseKey] = useState(0);
  useEffect(() => {
    if (heartFirstRef.current) {
      heartFirstRef.current = false;
      return;
    }
    if (post.likedByMe) setHeartPulseKey((k) => k + 1);
  }, [post.likedByMe]);

  const repostFirstRef = useRef(true);
  const [repostPulseKey, setRepostPulseKey] = useState(0);
  useEffect(() => {
    if (repostFirstRef.current) {
      repostFirstRef.current = false;
      return;
    }
    if (post.repostedByMe) setRepostPulseKey((k) => k + 1);
  }, [post.repostedByMe]);

  // The canonical id used for like/comment/repost aggregation.
  const originalId = post.repostOf?.id ?? post.id;

  useEffect(() => {
    if (!repostMenuOpen && !ownerMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (repostMenuOpen && repostMenuRef.current && !repostMenuRef.current.contains(t)) {
        setRepostMenuOpen(false);
      }
      if (ownerMenuOpen && ownerMenuRef.current && !ownerMenuRef.current.contains(t)) {
        setOwnerMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [repostMenuOpen, ownerMenuOpen]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["me-posts"] });
    qc.invalidateQueries({ queryKey: ["post", originalId] });
    qc.invalidateQueries({ queryKey: ["post", post.id] });
  };

  const likeMutation = useMutation({
    mutationFn: () => toggle({ data: { postId: originalId } }),
    onMutate: () => {
      const wasLiked = post.likedByMe;
      setLikeState(qc, originalId, !wasLiked, wasLiked ? -1 : 1);
      return { wasLiked };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      setLikeState(qc, originalId, ctx.wasLiked, ctx.wasLiked ? 1 : -1);
    },
    onSettled: invalidateAll,
  });

  const repostMutation = useMutation({
    mutationFn: () => repostFn({ data: { postId: originalId } }),
    onMutate: () => {
      if (post.repostedByMe) return { skipped: true };
      setRepostState(qc, originalId, true, 1);
      return { skipped: false };
    },
    onError: (_e, _v, ctx) => {
      if (ctx && !ctx.skipped) setRepostState(qc, originalId, false, -1);
    },
    onSettled: invalidateAll,
  });

  const undoRepostMutation = useMutation({
    mutationFn: () => undoRepostFn({ data: { postId: originalId } }),
    onMutate: () => {
      if (!post.repostedByMe) return { skipped: true };
      setRepostState(qc, originalId, false, -1);
      return { skipped: false };
    },
    onError: (_e, _v, ctx) => {
      if (ctx && !ctx.skipped) setRepostState(qc, originalId, true, 1);
    },
    onSettled: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFn({ data: { postId: post.id } }),
    onMutate: () => {
      removePost(qc, post.id);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["me-posts"] });
    },
    onSettled: invalidateAll,
  });

  const armConfirmDelete = () => {
    setConfirmDelete(true);
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => setConfirmDelete(false), 3000);
  };

  const isRepost = !!post.repostOf;
  const displayPost = post;

  const hasMedia = !!post.imageUrl || !!post.repostOf?.imageUrl;
  if (discreet && hasMedia) return null;
  const showMedia = !!post.imageUrl && !isRepost;
  const isTextOnly = !post.imageUrl && !isRepost && !!post.body;

  return (
    <article className="border-b border-white/5 pb-5">
      {isRepost && (
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Repeat2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {(() => {
              const reposterInner = (
                <>
                  <span className="h-4 w-4 rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10 inline-block align-middle">
                    {displayPost.author.avatarUrl && (
                      <img
                        src={displayPost.author.avatarUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </span>
                  <span>{displayPost.author.username} repostet</span>
                </>
              );
              return post.mine ? (
                <span className="inline-flex items-center gap-1.5">{reposterInner}</span>
              ) : (
                <Link
                  to="/u/$username"
                  params={{ username: displayPost.author.username }}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  {reposterInner}
                </Link>
              );
            })()}
          </div>
          {post.mine && (
            <OwnerMenuButton
              ref={ownerMenuRef}
              open={ownerMenuOpen}
              setOpen={setOwnerMenuOpen}
              isRepost={isRepost}
              onEdit={() => {
                setOwnerMenuOpen(false);
                setEditOpen(true);
              }}
              confirmDelete={confirmDelete}
              onDeleteClick={() => {
                if (!confirmDelete) {
                  armConfirmDelete();
                  return;
                }
                setOwnerMenuOpen(false);
                setConfirmDelete(false);
                deleteMutation.mutate();
              }}
              deletePending={deleteMutation.isPending}
            />
          )}
        </div>
      )}

      {!isRepost && (
        <header className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              const avatarInner = post.author.avatarUrl ? (
                <img
                  src={post.author.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : null;
              const avatarClass =
                "h-9 w-9 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10";
              const usernameClass = "text-sm font-medium truncate";
              return post.mine ? (
                <>
                  <span className={avatarClass} aria-hidden>
                    {avatarInner}
                  </span>
                  <div className="min-w-0">
                    <span className={usernameClass}>{post.author.username}</span>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</p>
                  </div>
                </>
              ) : (
                <>
                  <Link
                    to="/u/$username"
                    params={{ username: post.author.username }}
                    className={avatarClass}
                    aria-label={`Åpne ${post.author.username}`}
                  >
                    {avatarInner}
                  </Link>
                  <div className="min-w-0">
                    <Link
                      to="/u/$username"
                      params={{ username: post.author.username }}
                      className={`${usernameClass} hover:underline`}
                    >
                      {post.author.username}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</p>
                  </div>
                </>
              );
            })()}
          </div>
          {post.mine ? (
            <OwnerMenuButton
              ref={ownerMenuRef}
              open={ownerMenuOpen}
              setOpen={setOwnerMenuOpen}
              isRepost={false}
              onEdit={() => {
                setOwnerMenuOpen(false);
                setEditOpen(true);
              }}
              confirmDelete={confirmDelete}
              onDeleteClick={() => {
                if (!confirmDelete) {
                  armConfirmDelete();
                  return;
                }
                setOwnerMenuOpen(false);
                setConfirmDelete(false);
                deleteMutation.mutate();
              }}
              deletePending={deleteMutation.isPending}
            />
          ) : (
            <span className="h-8 w-8" aria-hidden />
          )}
        </header>
      )}

      {isRepost && post.body && (
        <div className="px-4 pt-2">
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">{post.body}</p>
        </div>
      )}

      {isRepost && post.repostOf && <EmbeddedOriginal original={post.repostOf} />}

      {showMedia && (
        <div className="relative w-full aspect-[4/5] overflow-hidden bg-black/40">
          <FadeImage
            src={post.imageUrl!}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {showMedia && post.body && (
        <div className="px-4 pt-2">
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">{post.body}</p>
        </div>
      )}

      {isTextOnly && (
        <div className="px-4 pt-1 pb-2">
          <p className="font-display text-xl leading-snug text-foreground/95 whitespace-pre-wrap">
            {post.body}
          </p>
        </div>
      )}

      <div className="flex items-center gap-5 px-4 pt-3">
        <button
          onClick={() => post.viewerCanEngage && likeMutation.mutate()}
          disabled={likeMutation.isPending || !post.viewerCanEngage}
          title={post.viewerCanEngage ? undefined : audienceLockTitle(post.engagementAudience)}
          className="flex items-center gap-1.5 text-sm text-foreground/80 hover:text-foreground transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <motion.span
            key={heartPulseKey}
            initial={heartPulseKey === 0 ? false : { scale: 1 }}
            animate={heartPulseKey === 0 ? undefined : { scale: [1, 1.3, 0.95, 1] }}
            transition={{ duration: 0.34, ease: MENU_EASE }}
            className="inline-flex"
          >
            <Heart
              className={`h-[22px] w-[22px] transition-colors duration-200 ${post.likedByMe ? "fill-[var(--color-accent)] stroke-[var(--color-accent)]" : ""}`}
              strokeWidth={1.6}
            />
          </motion.span>
          <span>{post.likeCount}</span>
        </button>
        {!hideCommentButton && (
          <button
            onClick={() => setDrawer(true)}
            className="flex items-center gap-1.5 text-sm text-foreground/80 hover:text-foreground transition"
          >
            <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.6} />
            <span>{post.commentCount}</span>
          </button>
        )}
        <div className="relative" ref={repostMenuRef}>
          <button
            onClick={() => post.viewerCanEngage && setRepostMenuOpen((v) => !v)}
            disabled={
              repostMutation.isPending ||
              undoRepostMutation.isPending ||
              !post.viewerCanEngage
            }
            title={post.viewerCanEngage ? undefined : audienceLockTitle(post.engagementAudience)}
            className={`flex items-center gap-1.5 text-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${post.repostedByMe ? "text-emerald-400" : "text-foreground/80 hover:text-foreground"}`}
            aria-label="Repost"
          >
            <motion.span
              key={repostPulseKey}
              initial={repostPulseKey === 0 ? false : { scale: 1 }}
              animate={repostPulseKey === 0 ? undefined : { scale: [1, 1.25, 0.95, 1] }}
              transition={{ duration: 0.34, ease: MENU_EASE }}
              className="inline-flex"
            >
              <Repeat2 className="h-[22px] w-[22px]" strokeWidth={1.6} />
            </motion.span>
            <span>{post.repostCount}</span>
          </button>
          <AnimatePresence>
            {repostMenuOpen && post.viewerCanEngage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 4 }}
                transition={{ duration: 0.16, ease: MENU_EASE }}
                style={{ transformOrigin: "bottom left" }}
                className="absolute bottom-9 left-0 z-20 min-w-[200px] rounded-xl border border-white/10 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden"
              >
                {post.repostedByMe ? (
                  <button
                    onClick={() => {
                      setRepostMenuOpen(false);
                      undoRepostMutation.mutate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
                  >
                    <Repeat2 className="h-4 w-4" />
                    Angre repost
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setRepostMenuOpen(false);
                      repostMutation.mutate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
                  >
                    <Repeat2 className="h-4 w-4" />
                    Repost
                  </button>
                )}
                <button
                  onClick={() => {
                    setRepostMenuOpen(false);
                    setQuoteOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5 border-t border-white/5"
                >
                  <PencilLine className="h-4 w-4" />
                  Sitér med kommentar
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Suspense fallback={null}>
        {drawerMounted && (
          <CommentDrawer
            postId={originalId}
            open={drawer}
            onClose={() => setDrawer(false)}
            canEngage={post.viewerCanEngage}
          />
        )}
        {quoteMounted && (
          <QuoteRepostModal
            open={quoteOpen}
            onClose={() => setQuoteOpen(false)}
            original={post.repostOf ?? {
              id: post.id,
              body: post.body,
              imageUrl: post.imageUrl,
              createdAt: post.createdAt,
              author: post.author,
            }}
            onPublished={invalidateAll}
          />
        )}
        {editMounted && (
          <EditPostModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            postId={post.id}
            initialBody={post.body}
          />
        )}
      </Suspense>
    </article>
  );
}



type OwnerMenuProps = {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  isRepost: boolean;
  onEdit: () => void;
  confirmDelete: boolean;
  onDeleteClick: () => void;
  deletePending: boolean;
};

const OwnerMenuButton = forwardRef<HTMLDivElement, OwnerMenuProps>(function OwnerMenuButton(
  { open, setOpen, isRepost, onEdit, confirmDelete, onDeleteClick, deletePending },
  ref,
) {
  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="Mer"
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/5 text-foreground/70"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.16, ease: MENU_EASE }}
            style={{ transformOrigin: "top right" }}
            className="absolute top-9 right-0 z-20 min-w-[200px] rounded-xl border border-white/10 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden"
          >
            {!isRepost && (
              <button
                onClick={onEdit}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
              >
                <PencilLine className="h-4 w-4" />
                Rediger
              </button>
            )}
            <button
              onClick={onDeleteClick}
              disabled={deletePending}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left transition border-t border-white/5 ${confirmDelete ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "text-red-300 hover:bg-white/5"} disabled:opacity-60`}
            >
              <Trash2 className="h-4 w-4" />
              {confirmDelete ? "Bekreft sletting" : "Slett"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
