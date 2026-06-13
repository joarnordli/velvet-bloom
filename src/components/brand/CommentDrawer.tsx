import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CommentsList } from "./CommentsList";

export function CommentDrawer({
  postId,
  open,
  onClose,
  canEngage = true,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
  canEngage?: boolean;
}) {
  const [dragY, setDragY] = useState(0);
  const [shown, setShown] = useState(false);
  const startYRef = useRef<number | null>(null);

  // One-tick after mount, flip `shown` so the entry transition plays.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  if (typeof document === "undefined") return null;

  const onTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 120) onClose();
    else setDragY(0);
    startYRef.current = null;
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          shown && open ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 h-[80dvh] glass-strong rounded-t-3xl flex flex-col ${
          dragY > 0 ? "" : "transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
        } ${shown && open ? "translate-y-0" : "translate-y-full"}`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* Swipe handle */}
        <div
          className="shrink-0 pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          role="button"
          aria-label="Lukk kommentarer"
          onClick={onClose}
        >
          <div className="mx-auto h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <div className="flex-1 min-h-0">
          <CommentsList
            postId={postId}
            enabled={open}
            onNavigate={onClose}
            canEngage={canEngage}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
