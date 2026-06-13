import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate, useSearch } from "@tanstack/react-router";

const VIEWS = [
  { id: "anbefalt", label: "Anbefalt" },
  { id: "folger", label: "Følger" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];
const EASE = [0.32, 0.72, 0, 1] as const;

export function FeedHeader() {
  const { view } = useSearch({ from: "/_authenticated/" });
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-foreground/95"
        >
          <span className="font-display text-2xl tracking-tight">{current.label}</span>
          <ChevronDown className={`h-4 w-4 mt-1 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.16, ease: EASE }}
              style={{ transformOrigin: "top left" }}
              className="absolute left-0 top-full mt-2 glass-strong rounded-2xl p-1.5 min-w-[160px] z-30"
            >
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setOpen(false);
                    if (v.id !== view) {
                      navigate({ to: "/", search: { view: v.id } });
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm transition ${
                    v.id === view ? "bg-white/8 text-foreground" : "text-foreground/75 hover:bg-white/5"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <button
        aria-label="Filter"
        className="h-9 w-9 grid place-items-center rounded-full text-foreground/70 hover:text-foreground hover:bg-white/5 transition"
      >
        <SlidersHorizontal className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
