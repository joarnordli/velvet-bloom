import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

const TAB_PATHS = new Set(["/", "/oppdag", "/meldinger", "/profile", "/auth"]);
const EDGE_ZONE_PX = 24; // start gesture only when finger lands in the left 24px
const DISMISS_RATIO = 0.35; // 35% of viewport width to pop
const DISMISS_VELOCITY = 0.5; // px/ms

/**
 * iOS-style edge-swipe-back. Active only on pushed detail screens —
 * tab roots ignore the gesture so the existing tab-swipe nav still works.
 */
export function useEdgeSwipeBack() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (TAB_PATHS.has(pathname)) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let layer: HTMLElement | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE_PX) return;
      // ignore swipes that begin on a row with its own swipe action
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-swipe-row]")) return;
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp;
      // We translate the closest motion layer if present
      layer = document.querySelector<HTMLElement>("[data-route-layer]");
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx < 0) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        tracking = false;
        if (layer) layer.style.transform = "";
        return;
      }
      e.preventDefault();
      const w = window.innerWidth;
      const pct = Math.min(1, dx / w);
      if (layer) {
        layer.style.transform = `translateX(${dx}px)`;
        layer.style.transition = "none";
        layer.style.boxShadow = `-${10 + 30 * pct}px 0 60px rgba(0,0,0,${0.3 * (1 - pct)})`;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dt = Math.max(1, e.timeStamp - startT);
      const velocity = dx / dt;
      const w = window.innerWidth;
      const shouldDismiss = dx > w * DISMISS_RATIO || velocity > DISMISS_VELOCITY;

      if (layer) {
        layer.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms";
        if (shouldDismiss) {
          layer.style.transform = `translateX(${w}px)`;
          setTimeout(() => {
            if (layer) {
              layer.style.transition = "";
              layer.style.transform = "";
              layer.style.boxShadow = "";
            }
          }, 240);
          router.history.back();
        } else {
          layer.style.transform = "";
          layer.style.boxShadow = "";
          setTimeout(() => {
            if (layer) layer.style.transition = "";
          }, 240);
        }
      } else if (shouldDismiss) {
        router.history.back();
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [pathname, router]);
}
