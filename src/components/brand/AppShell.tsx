import type { ReactNode } from "react";

/**
 * Thin content wrapper for framed routes. The inner scroller, the top/bottom
 * chrome, and the md+ SideNav offset all live in <AppFrame> now — this only
 * adds page padding so route content breathes inside the scroller.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return <div className="pt-2 pb-12 md:pt-6 md:pr-4">{children}</div>;
}
