import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

type Tab = "/oppdag" | "/" | "/meldinger";
const ORDER: Tab[] = ["/oppdag", "/", "/meldinger"];
const TAB_SET = new Set<string>(ORDER);

const IGNORE_SELECTOR =
  'a, button, [role="button"], input, textarea, label, [data-swipe-row], [data-nochrome-swipe]';

const COMMIT_PX = 70;
const RATIO = 1.8;

/**
 * Global tab-swipe nav. Document-level so it isn't tied to any subtree,
 * and ignores touches that start on links/buttons so list rows
 * (e.g. /meldinger conversation rows) don't swallow the gesture.
 */
export function useTabSwipeNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if (!TAB_SET.has(pathname)) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(IGNORE_SELECTOR)) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < COMMIT_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * RATIO) return;

      const idx = ORDER.indexOf(pathname as Tab);
      if (idx === -1) return;
      const nextIdx = dx < 0 ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= ORDER.length) return;

      // Swallow the trailing synthetic click iOS fires after touchend.
      const killClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", killClick, true);
      };
      window.addEventListener("click", killClick, true);
      setTimeout(() => window.removeEventListener("click", killClick, true), 400);

      navigate({ to: ORDER[nextIdx] });
    };

    const onCancel = () => {
      tracking = false;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [pathname, navigate]);
}
