import { Search, Heart, Bookmark, MessageCircle, Home } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useUnreadCounts } from "@/hooks/use-unread-counts";

const items = [
  { key: "discover", label: "Oppdag", icon: Search, to: "/oppdag" as const },
  { key: "match", label: "Kink-Match", icon: Heart, to: null },
  { key: "home", label: "Hjem", icon: Home, to: "/" as const },
  { key: "bookmarks", label: "Bokmerker", icon: Bookmark, to: null },
  { key: "messages", label: "Meldinger", icon: MessageCircle, to: "/meldinger" as const },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { messages: msgCount } = useUnreadCounts();

  return (
    <nav className="absolute inset-x-0 bottom-0 z-30 pointer-events-none md:hidden pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
      <div className="mx-auto max-w-2xl px-5">
        <div data-nochrome-swipe className="glass-strong pointer-events-auto rounded-full px-3 py-2 flex items-center justify-between">
          {items.map((it) => {
            const isActive = it.to ? pathname === it.to : false;
            const Icon = it.icon;
            const inner = Icon ? (
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />
            ) : null;
            const showMsgDot = it.key === "messages" && msgCount > 0;

            const className = `relative h-11 w-11 rounded-full grid place-items-center transition-colors duration-200 ${
              isActive ? "text-foreground" : "text-foreground/55 hover:text-foreground/90"
            }`;

            const pill = isActive ? (
              <motion.span
                layoutId="bottom-nav-pill"
                transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
                className="absolute inset-0 rounded-full bg-white/8"
                aria-hidden
              />
            ) : null;

            const dot = showMsgDot ? (
              <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-notif-dot)] ring-2 ring-[var(--background)] z-10" />
            ) : null;

            if (it.to) {
              return (
                <Link key={it.key} to={it.to} preload="viewport" aria-label={it.label} className={className}>
                  {pill}
                  <span className="relative">{inner}</span>
                  {dot}
                </Link>
              );
            }
            return (
              <button key={it.key} aria-label={it.label} className={className} disabled>
                {pill}
                <span className="relative">{inner}</span>
                {dot}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
