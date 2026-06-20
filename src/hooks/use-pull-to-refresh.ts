import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Pull-to-refresh for the single AppFrame `<main>` scroller.
 *
 * The shell owns the only scroll container (see AppFrame), so each screen can't
 * just wrap its own scroller. Instead a screen calls `useRegisterRefresh(fn)` to
 * register its refresh handler into the shell; AppFrame runs the touch gesture on
 * the scroller and invokes whatever the active screen registered. Touch-only —
 * desktop relies on refetch-on-focus and (later) the realtime socket.
 */

export type RefreshHandler = () => unknown | Promise<unknown>;

export const PullToRefreshContext = createContext<{
  register: (fn: RefreshHandler | null) => void;
}>({ register: () => {} });

/** Screens call this to expose their refresh action to the shell's gesture. */
export function useRegisterRefresh(onRefresh: RefreshHandler): void {
  const { register } = useContext(PullToRefreshContext);
  // Keep the latest handler in a ref so re-renders don't re-register / thrash.
  const ref = useRef(onRefresh);
  ref.current = onRefresh;
  useEffect(() => {
    register(() => ref.current());
    return () => register(null);
  }, [register]);
}

const THRESHOLD = 70; // px pull (after resistance) needed to trigger
const MAX = 110; // px cap on the indicator travel

/**
 * Binds the pull gesture to a scroll element. Returns `pull` (0..MAX px) for the
 * indicator and `refreshing` while the handler runs. Listeners are passive — we
 * never preventDefault; at scrollTop 0 a downward drag doesn't scroll content,
 * and AppFrame's `overscroll-behavior:contain` suppresses the page bounce.
 */
export function usePullToRefreshGesture(
  el: HTMLElement | null,
  onRefresh: RefreshHandler | null,
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const s = useRef({ startY: 0, active: false, pull: 0, refreshing: false });
  const handler = useRef(onRefresh);
  handler.current = onRefresh;

  useEffect(() => {
    if (!el) return;
    const set = (v: number) => {
      s.current.pull = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || s.current.refreshing || !handler.current) return;
      s.current.startY = e.touches[0].clientY;
      s.current.active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!s.current.active) return;
      const dy = e.touches[0].clientY - s.current.startY;
      if (dy <= 0) return set(0);
      set(Math.min(MAX, dy * 0.5)); // rubber-band resistance
    };
    const onEnd = async () => {
      if (!s.current.active) return;
      s.current.active = false;
      if (s.current.pull >= THRESHOLD && handler.current) {
        s.current.refreshing = true;
        setRefreshing(true);
        set(THRESHOLD);
        try {
          await handler.current();
        } finally {
          s.current.refreshing = false;
          setRefreshing(false);
          set(0);
        }
      } else {
        set(0);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [el]);

  return { pull, refreshing };
}

export const PULL_THRESHOLD = THRESHOLD;
