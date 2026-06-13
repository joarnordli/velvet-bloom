import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useRouterState } from "@tanstack/react-router";

/**
 * iOS-style screen transitions (enter-only — TanStack Router unmounts the
 * outgoing route immediately, so we focus on softening the incoming one).
 */

const TAB_PATHS = new Set(["/", "/oppdag", "/meldinger", "/profile", "/auth"]);
const isTabPath = (p: string) => TAB_PATHS.has(p);

const SPRING = { type: "spring" as const, stiffness: 320, damping: 34, mass: 0.9 };

type Phase = "tab" | "push" | "pop";

export function RouteTransitions({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const reduce = useReducedMotion();

  const prevPathRef = useRef(pathname);
  const layerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("tab");

  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev === pathname) return;
    const prevTab = isTabPath(prev);
    const nextTab = isTabPath(pathname);
    if (prevTab && nextTab) setPhase("tab");
    else if (prevTab && !nextTab) setPhase("push");
    else if (!prevTab && nextTab) setPhase("pop");
    else setPhase("push");
    prevPathRef.current = pathname;
  }, [pathname]);

  if (reduce) return <>{children}</>;

  const initial =
    phase === "push"
      ? { x: "100%", opacity: 1 }
      : phase === "pop"
        ? { x: "-12%", opacity: 0 }
        : { opacity: 0, y: 4 };

  const transition =
    phase === "tab"
      ? { duration: 0.14, ease: [0.32, 0.72, 0, 1] as const }
      : SPRING;

  return (
    <motion.div
      key={pathname}
      ref={layerRef}
      initial={initial}
      animate={{ x: 0, opacity: 1, y: 0 }}
      transition={transition}
      onAnimationComplete={() => {
        // Release the compositing hints once settled so any `position: fixed`
        // descendants (modals, drawers) anchor to the viewport again. Targeted
        // via ref rather than a pathname data-attribute — that attribute was the
        // sole SSR/client hydration mismatch (server "/" vs client redirect).
        const el = layerRef.current;
        if (el) {
          el.style.transform = "none";
          el.style.willChange = "auto";
        }
      }}
      data-route-layer
      style={{ willChange: "transform, opacity" }}
    >
      {children}
    </motion.div>
  );
}
