import { useEffect, useMemo, useRef, useState } from "react";

const EMOJI = [
  "😀","😄","😅","😂","🤣","😊","😉","😍","😘","😜",
  "🤩","🥳","😎","🤔","🙄","😴","😢","😭","😡","🤯",
  "👍","👎","👏","🙏","💪","🙌","🤝","🫶","👀","🔥",
  "💯","✨","🎉","🥂","❤️","🧡","💛","💚","💙","💜",
  "🖤","🤍","💔","💖","💕","😈","🍑","🍆","💋","🌹",
];

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items = useMemo(() => EMOJI, []);

  return (
    <div
      ref={ref}
      className="absolute bottom-14 right-3 z-20 glass rounded-2xl p-2 shadow-2xl border border-white/10 grid grid-cols-10 gap-1 max-w-[18rem]"
      role="dialog"
      aria-label="Velg emoji"
    >
      {items.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-lg leading-none"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function useEmojiPicker() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
