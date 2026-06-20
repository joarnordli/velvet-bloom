import { useRouterState } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";
import { Fab } from "./Fab";
import {
  PullToRefreshContext,
  usePullToRefreshGesture,
  PULL_THRESHOLD,
  type RefreshHandler,
} from "@/hooks/use-pull-to-refresh";

/**
 * Non-scrolling app shell. The <body> is locked (styles.css) and a single inner
 * <main> scrolls, with the top/bottom nav as FLEX SIBLINGS rather than
 * position: fixed. This is the only layout that survives the iOS standalone
 * keyboard cleanly: the document never scrolls, so the chrome can't drift or
 * jitter — the same pattern the chat thread already uses.
 *
 * Replaces the old GlobalChrome: same route-type handling (no chrome on /auth,
 * chrome-less immersive routes), but it now owns the layout + the scroller.
 */

// Per-route scroll offsets for the inner scroller (module scope: survives the
// content swap on navigation). Best-effort back-to-feed restoration.
const scrollPositions = new Map<string, number>();

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);

  const isAuth = pathname.startsWith("/auth");
  // Immersive routes (chat thread) own the full viewport and their own scroll.
  const isImmersive = /^\/meldinger\/[^/]+/.test(pathname);
  const framed = !isAuth && !isImmersive;

  // Pull-to-refresh: the active screen registers a handler; the gesture runs on
  // the <main> scroller (captured into state via a callback ref so the hook
  // re-binds when it mounts).
  const handlerRef = useRef<RefreshHandler | null>(null);
  const register = useCallback((fn: RefreshHandler | null) => {
    handlerRef.current = fn;
  }, []);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const setMain = useCallback((el: HTMLElement | null) => {
    mainRef.current = el;
    setMainEl(el);
  }, []);
  const { pull, refreshing } = usePullToRefreshGesture(
    framed ? mainEl : null,
    () => handlerRef.current?.(),
  );

  useEffect(() => {
    if (!framed) return;
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => scrollPositions.set(pathname, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pathname, framed]);

  useLayoutEffect(() => {
    if (!framed) return;
    const el = mainRef.current;
    if (el) el.scrollTop = scrollPositions.get(pathname) ?? 0;
  }, [pathname, framed]);

  // Auth: no chrome, its own scroller.
  if (isAuth) {
    return <div className="h-[100dvh] overflow-y-auto">{children}</div>;
  }

  // Immersive (chat): the route owns its 100dvh layout; only the desktop rail.
  if (isImmersive) {
    return (
      <>
        <SideNav />
        {children}
      </>
    );
  }

  return (
    <PullToRefreshContext.Provider value={{ register }}>
      <SideNav />
      <div className="relative flex h-[100dvh] flex-col md:pl-[17rem]">
        <TopNav />
        <main
          ref={setMain}
          className="flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] [touch-action:pan-y]"
        >
          <PullIndicator pull={pull} refreshing={refreshing} />
          {children}
        </main>
        {/* Floats over the bottom of the scroller (content passes behind the
            glass pill) but stays immovable — it's absolute inside the locked,
            non-scrolling shell, not fixed to the viewport. */}
        <BottomNav />
      </div>
      <Fab />
    </PullToRefreshContext.Provider>
  );
}

/** Spinner pinned to the top of the scroller; grows/rotates with the pull. */
function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (pull <= 0 && !refreshing) return null;
  const progress = Math.min(1, pull / PULL_THRESHOLD);
  return (
    <div className="pointer-events-none sticky top-0 z-20 flex h-0 justify-center overflow-visible">
      <div
        className="mt-2 grid h-9 w-9 place-items-center rounded-full glass-strong shadow-lg"
        style={{
          transform: `translateY(${Math.max(0, pull - 12)}px)`,
          opacity: refreshing ? 1 : progress,
        }}
      >
        <Loader2
          className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
        />
      </div>
    </div>
  );
}
