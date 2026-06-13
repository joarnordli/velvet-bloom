import { Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { listComments, addComment, deleteComment } from "@/lib/comments.functions";
import {
  addCommentToCache,
  bumpCommentCount,
  removeCommentFromCache,
  type CommentLite,
  type CommentListResult,
} from "@/lib/post-cache";

const EASE = [0.32, 0.72, 0, 1] as const;

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

type Props = {
  postId: string;
  enabled?: boolean;
  onNavigate?: () => void;
  canEngage?: boolean;
};

export function CommentsList({ postId, enabled = true, onNavigate, canEngage = true }: Props) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listComments);
  const sendComment = useServerFn(addComment);
  const removeComment = useServerFn(deleteComment);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => fetchList({ data: { postId } }),
    enabled,
  });
  const comments = data?.comments ?? [];
  const currentUserId = data?.currentUserId ?? null;

  // Scroll to bottom when the list grows (new comment added).
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (comments.length > lastCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    lastCountRef.current = comments.length;
  }, [comments.length]);

  const addMutation = useMutation({
    mutationFn: async (body: string): Promise<{ tempId: string; body: string }> => {
      const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
      const optimistic: CommentLite = {
        id: tempId,
        body,
        createdAt: new Date().toISOString(),
        author: {
          id: currentUserId ?? "",
          username: "du",
        },
      };
      addCommentToCache(qc, postId, optimistic);
      bumpCommentCount(qc, postId, 1);
      setText("");
      await sendComment({ data: { postId, body } });
      return { tempId, body };
    },
    onError: (_e, _v, _ctx) => {
      // Roll back the optimistic count; refetch to reconcile body list.
      bumpCommentCount(qc, postId, -1);
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
    onSuccess: () => {
      // Refetch swaps the temp row for the real one.
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const prev = qc.getQueryData<CommentListResult>(["comments", postId]);
      removeCommentFromCache(qc, postId, commentId);
      bumpCommentCount(qc, postId, -1);
      try {
        await removeComment({ data: { commentId } });
      } catch (err) {
        // Roll back
        if (prev) qc.setQueryData(["comments", postId], prev);
        bumpCommentCount(qc, postId, 1);
        throw err;
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
  });

  const submit = () => {
    const t = text.trim();
    if (!t || addMutation.isPending) return;
    addMutation.mutate(t);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Laster…</p>}
        {!isLoading && comments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ingen kommentarer ennå. Vær den første.
          </p>
        )}
        <AnimatePresence initial={false}>
          {comments.map((c) => {
            const isMine = currentUserId === c.author.id;
            const isPending = c.id.startsWith("tmp-");
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 6, height: 0 }}
                animate={{ opacity: isPending ? 0.6 : 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -4, height: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="flex gap-3 group pb-4">
                  {isMine ? (
                    <span
                      className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-white/15 to-white/5 ring-1 ring-white/10"
                      aria-hidden
                    />
                  ) : (
                    <Link
                      to="/u/$username"
                      params={{ username: c.author.username }}
                      onClick={onNavigate}
                      className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-white/15 to-white/5 ring-1 ring-white/10"
                      aria-label={`Åpne ${c.author.username}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {isMine ? (
                        <span className="font-medium text-foreground">
                          {c.author.username}
                        </span>
                      ) : (
                        <Link
                          to="/u/$username"
                          params={{ username: c.author.username }}
                          onClick={onNavigate}
                          className="font-medium text-foreground hover:underline"
                        >
                          {c.author.username}
                        </Link>
                      )}{" "}
                      <span className="text-foreground/80 whitespace-pre-wrap">{c.body}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {timeAgo(c.createdAt)}
                    </p>
                  </div>
                  {isMine && !isPending && (
                    <button
                      onClick={() => deleteMutation.mutate(c.id)}
                      disabled={deleteMutation.isPending}
                      aria-label="Slett kommentar"
                      className="h-8 w-8 shrink-0 grid place-items-center rounded-full text-foreground/50 hover:text-foreground hover:bg-white/5 transition disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Composer pinned at bottom — hidden when the viewer cannot engage */}
      {canEngage ? (
        <div
          className="shrink-0 border-t border-white/8 px-3 pt-3 bg-background/40 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="glass flex items-center gap-2 rounded-full pl-4 pr-1.5 py-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Legg til en kommentar..."
              maxLength={500}
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground py-2"
            />
            <button
              aria-label="Send"
              onClick={submit}
              disabled={!text.trim() || addMutation.isPending}
              className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/15 transition disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className="shrink-0 border-t border-white/8 px-5 py-3 text-center text-xs text-muted-foreground"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          Du kan ikke kommentere på dette innlegget.
        </div>
      )}
    </div>
  );
}
