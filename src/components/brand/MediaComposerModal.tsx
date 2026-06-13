import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import type { ComposerPhase } from "./usePostComposer";
import { SheetModal } from "./SheetModal";

const MAX = 500;

export function MediaComposerModal({
  open,
  file,
  previewUrl,
  phase,
  errorMessage,
  onPublish,
  onClose,
}: {
  open: boolean;
  file: File | null;
  previewUrl: string | null;
  phase: ComposerPhase;
  errorMessage: string | null;
  onPublish: (caption: string) => void;
  onClose: () => void;
}) {
  const [caption, setCaption] = useState("");

  useEffect(() => {
    if (file) setCaption("");
  }, [file]);

  const busy = phase === "uploading";
  const done = phase === "success";

  return (
    <SheetModal
      open={open && !!file && !!previewUrl}
      onClose={onClose}
      blockClose={busy}
      panelClassName="overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="font-display text-lg">Nytt innlegg</h3>
        <button
          onClick={onClose}
          disabled={busy}
          className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/5 disabled:opacity-40"
          aria-label="Lukk"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative w-full aspect-[4/5] bg-black/60">
        {previewUrl && <img src={previewUrl} alt="" className="w-full h-full object-cover" />}
        {(busy || done) && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
            <ProgressRing done={done} />
          </div>
        )}
      </div>

      <div className="px-5 pt-4">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, MAX))}
          placeholder="Skriv en bildetekst…"
          rows={3}
          disabled={busy}
          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none resize-none text-sm leading-relaxed"
        />
      </div>

      <div className="flex items-center justify-between px-5 pb-5">
        <span className="text-xs text-muted-foreground">
          {caption.length} / {MAX}
        </span>
        <button
          onClick={() => onPublish(caption)}
          disabled={busy || done}
          className="px-5 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 transition"
        >
          Publiser
        </button>
      </div>

      {errorMessage && phase === "error" && (
        <p className="px-5 pb-4 -mt-3 text-xs text-[oklch(0.72_0.18_25)]">
          {errorMessage}
        </p>
      )}
    </SheetModal>
  );
}

function ProgressRing({ done }: { done: boolean }) {
  const SIZE = 56;
  const STROKE = 3.5;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (done) {
      setProgress(1);
      return;
    }
    setProgress(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const p = 1 - Math.exp(-elapsed / 2.5);
      setProgress(Math.min(p * 0.92, 0.92));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [done]);

  const offset = C * (1 - progress);

  return (
    <div className="relative h-14 w-14">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.15)" strokeWidth={STROKE} fill="none" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="white"
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease-out" }}
        />
      </svg>
      <div
        className={`absolute inset-0 grid place-items-center transition-opacity duration-300 ${
          done ? "opacity-100" : "opacity-0"
        }`}
      >
        <Check className="h-5 w-5 text-white" strokeWidth={2.5} />
      </div>
    </div>
  );
}
