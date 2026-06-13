import { useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createPost } from "@/lib/posts.functions";
import { SheetModal } from "./SheetModal";

const MAX = 500;

export function WritePostModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const qc = useQueryClient();
  const createPostFn = useServerFn(createPost);

  const mutation = useMutation({
    mutationFn: (text: string) => createPostFn({ data: { body: text } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["feed"] });
      onClose();
    },
  });

  return (
    <SheetModal open={open} onClose={onClose} blockClose={mutation.isPending} panelClassName="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl">Skriv en post</h3>
        <button
          onClick={onClose}
          disabled={mutation.isPending}
          className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/5"
          aria-label="Lukk"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX))}
        placeholder="Hva tenker du på?"
        rows={5}
        autoFocus
        className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none resize-none text-base leading-relaxed"
      />

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-muted-foreground">
          {body.length} / {MAX}
        </span>
        <button
          onClick={() => mutation.mutate(body.trim())}
          disabled={mutation.isPending || body.trim().length === 0}
          className="px-5 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 transition"
        >
          {mutation.isPending ? "Sender…" : "Publiser"}
        </button>
      </div>

      {mutation.error && (
        <p className="text-xs text-[oklch(0.72_0.18_25)] mt-3">
          {(mutation.error as Error).message}
        </p>
      )}
    </SheetModal>
  );
}
