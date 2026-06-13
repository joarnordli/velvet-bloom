import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EASE = "cubic-bezier(0.32,0.72,0,1)";
const DUR = "300ms";

/**
 * Bottom-sheet / centered-modal shell with smooth in/out.
 *
 * Always renders into a portal. Drives backdrop opacity and panel translate
 * off the `open` prop so a parent can keep this mounted while it animates
 * out (pair with useDeferredUnmount). A one-frame `shown` flag ensures the
 * entry transition runs even when the component is mounted with `open=true`.
 */
export function SheetModal({
  open,
  onClose,
  children,
  panelClassName = "",
  blockClose = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  blockClose?: boolean;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !blockClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, blockClose]);

  if ((!open && !shown) || typeof document === "undefined") return null;

  const visible = open && shown;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        onClick={() => !blockClose && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{
          transition: `opacity ${DUR} ${EASE}`,
          opacity: visible ? 1 : 0,
        }}
      />
      <div
        className={`relative w-full sm:max-w-md glass-strong rounded-t-3xl sm:rounded-3xl border border-white/10 ${panelClassName}`}
        style={{
          transition: `transform ${DUR} ${EASE}, opacity ${DUR} ${EASE}`,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          opacity: visible ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

