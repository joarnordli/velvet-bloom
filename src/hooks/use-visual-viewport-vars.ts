import { useEffect } from "react";

/**
 * Flips `data-keyboard-open` on <html> when the on-screen keyboard is up,
 * driven by `window.visualViewport`. App chrome (bottom nav + FAB) uses it to
 * slide out of the way while typing instead of floating above the keyboard.
 *
 * Deliberately minimal: it does NOT react to scroll and only touches the DOM
 * when the keyboard state actually changes — so it never repaints the blurred
 * chrome during momentum scroll (the old per-frame CSS-var writes caused that
 * jitter). Mount once at the app root.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    let frame = 0;
    let open = false;

    const apply = () => {
      frame = 0;
      // How much the visible viewport has shrunk vs. the layout viewport — i.e.
      // the keyboard height on iOS (where the keyboard overlays rather than
      // resizing the page). 120px clears non-keyboard noise (accessory bars).
      const bottomInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const next = bottomInset > 120;
      if (next === open) return;
      open = next;
      if (open) root.setAttribute("data-keyboard-open", "true");
      else root.removeAttribute("data-keyboard-open");
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.removeAttribute("data-keyboard-open");
    };
  }, []);
}
