import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, PencilLine, Loader2 } from "lucide-react";
import { updatePostBody } from "@/lib/posts.functions";
import { patchPostBody } from "@/lib/post-cache";
import { SheetModal } from "./SheetModal";

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
  initialBody: string;
};

export function EditPostModal({ open, onClose, postId, initialBody }: Props) {
  const [body, setBody] = useState(initialBody);
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePostBody);

  useEffect(() => {
    if (open) setBody(initialBody);
  }, [open, initialBody]);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = body.trim();
      patchPostBody(qc, postId, trimmed);
      await updateFn({ data: { postId, body: trimmed } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["post", postId] });
      onClose();
    },
    onError: () => {
      patchPostBody(qc, postId, initialBody);
    },
  });

  const trimmed = body.trim();
  const disabled =
    mutation.isPending ||
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    trimmed === initialBody.trim();

  return (
    <SheetModal open={open} onClose={onClose} blockClose={mutation.isPending}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <PencilLine className="h-4 w-4" />
          Rediger post
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
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          rows={5}
          className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          autoFocus
        />
        <div className="flex items-center justify-between pt-1">
          <span
            className={`text-[11px] ${body.length > 480 ? "text-red-400" : "text-muted-foreground"}`}
          >
            {body.length}/500
          </span>
          <button
            onClick={() => mutation.mutate()}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Lagre
          </button>
        </div>
      </div>
    </SheetModal>
  );
}
