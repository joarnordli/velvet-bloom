import { useRouterState } from "@tanstack/react-router";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";
import { Fab } from "./Fab";
import { useVisualViewportVars } from "@/hooks/use-visual-viewport-vars";

/**
 * Global app chrome rendered at the router root, OUTSIDE the
 * RouteTransitions wrapper. The transition layer applies
 * transform/will-change, which makes any `position: fixed` descendant
 * scope to the wrapper instead of the viewport. Keeping the nav bars
 * here ensures they truly float at the edge of the screen on every
 * route, including conversations.
 *
 * Chrome is hidden on /auth (and not-yet-mounted on the bare 404).
 */
export function GlobalChrome() {
  useVisualViewportVars();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname.startsWith("/auth")) return null;

  // Immersive routes own the full viewport — no global chrome may render,
  // so nothing can overlap their content (e.g. a chat composer). Add new
  // immersive surfaces (fullscreen media viewer, camera, etc.) here.
  const isImmersive = /^\/meldinger\/[^/]+/.test(pathname);
  if (isImmersive) {
    // SideNav still renders on md+ (it's left-anchored and the thread
    // offsets with md:pl-[17rem]); top/bottom chrome and FAB are removed.
    return <SideNav />;
  }

  return (
    <>
      <SideNav />
      <TopNav />
      <BottomNav />
      <Fab />
    </>
  );
}
