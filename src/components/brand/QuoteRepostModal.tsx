import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Repeat2, Loader2 } from "lucide-react";
import type { RepostOriginal } from "@/lib/posts.functions";
import { repostPost } from "@/lib/reposts.functions";
import { setRepostState } from "@/lib/post-cache";
import { SheetModal } from "./SheetModal";
import { FadeImage } from "./FadeImage";

type Props = {
  open: boolean;
  onClose: () => void;
  original: RepostOriginal;
  onPublished?: () => void;
};

export function QuoteRepostModal({ open, onClose, original, onPublished }: Props) {
  const [caption, setCaption] = useState("");
  const qc = useQueryClient();
  const repostFn = useServerFn(repostPost);

  useEffect(() => {
    if (!open) setCaption("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      repostFn({ data: { postId: original.id, caption: caption.trim() } }),
    onSuccess: () => {
      // Quote-repost doesn't flip repostedByMe (that's plain-repost state),
      // but it does increase the visible repost count on the original.
      setRepostState(qc, original.id, true, 1);
      onPublished?.();
      onClose();
    },
  });

  const disabled = mutation.isPending || caption.trim().length === 0;

  return (
    <SheetModal open={open} onClose={onClose} blockClose={mutation.isPending}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Repeat2 className="h-4 w-4" />
            Sitér post
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/5"
            aria-label="Lukk"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 500))}
            placeholder="Legg til en kommentar…"
            rows={3}
            className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />

          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-3">
              <div className="h-6 w-6 rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10">
                {original.author.avatarUrl && (
                  <img
                    src={original.author.avatarUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <span className="text-xs font-medium">{original.author.username}</span>
            </div>
            {original.body && (
              <p className="px-3 pt-1.5 pb-2 text-sm text-foreground/90 whitespace-pre-wrap line-clamp-4">
                {original.body}
              </p>
            )}
            {original.imageUrl && (
              <div className="w-full max-h-60 overflow-hidden bg-black/40">
                <FadeImage
                  src={original.imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className={`text-[11px] ${caption.length > 480 ? "text-red-400" : "text-muted-foreground"}`}>
              {caption.length}/500
            </span>
            <button
              onClick={() => mutation.mutate()}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Publiser
            </button>
          </div>
        </div>
    </SheetModal>
  );
}
