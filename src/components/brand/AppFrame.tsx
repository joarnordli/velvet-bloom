import { useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";
import { Fab } from "./Fab";

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
    <>
      <SideNav />
      <div className="relative flex h-[100dvh] flex-col md:pl-[17rem]">
        <TopNav />
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] [touch-action:pan-y]"
        >
          {children}
        </main>
        {/* Floats over the bottom of the scroller (content passes behind the
            glass pill) but stays immovable — it's absolute inside the locked,
            non-scrolling shell, not fixed to the viewport. */}
        <BottomNav />
      </div>
      <Fab />
    </>
  );
}
