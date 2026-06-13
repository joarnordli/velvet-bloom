import { useEffect } from "react";

/**
 * Publishes `--vv-top` and `--vv-bottom` CSS variables on <html>, driven by
 * `window.visualViewport`. App chrome (top/bottom nav) uses these to stay
 * pinned to the visible region on iOS Safari — surviving keyboard, URL-bar
 * collapse, pull-to-refresh, and rubber-band scroll.
 *
 * Also flips `data-keyboard-open` so consumers can opt out of certain
 * behaviours while typing.
 *
 * Mount once at the app root.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const vv = window.visualViewport;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const offsetTop = vv?.offsetTop ?? 0;
      const vh = vv?.height ?? window.innerHeight;
      const bottomInset = Math.max(0, window.innerHeight - vh - offsetTop);
      root.style.setProperty("--vv-top", `${offsetTop}px`);
      root.style.setProperty("--vv-bottom", `${bottomInset}px`);
      if (bottomInset > 120) root.setAttribute("data-keyboard-open", "true");
      else root.removeAttribute("data-keyboard-open");
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();

    if (vv) {
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (vv) {
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-bottom");
      root.removeAttribute("data-keyboard-open");
    };
  }, []);
}
