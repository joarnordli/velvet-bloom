import type { ReactNode } from "react";

/**
 * Page container. Global chrome (top/bottom nav, FAB, side nav) lives at
 * the router root via <GlobalChrome /> so `position: fixed` actually
 * anchors to the viewport — not to the transformed transition layer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh text-foreground">
      <main className="md:pl-[17rem]">
        <div className="pt-28 pb-32 md:pt-6 md:pb-10 md:pr-4 [touch-action:pan-y] [overscroll-behavior-x:contain]">
          {children}
        </div>
      </main>
    </div>
  );
}

