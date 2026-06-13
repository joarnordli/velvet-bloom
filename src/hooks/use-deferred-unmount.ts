import { useEffect, useState } from "react";

/**
 * Keeps a component mounted for `ms` after `open` flips to false so its
 * exit transition has time to play before React removes it from the DOM.
 *
 * Pattern:
 *   const mounted = useDeferredUnmount(open, 300);
 *   return mounted ? <Modal open={open} /> : null;
 *
 * The modal itself must drive its in/out animation off the `open` prop.
 */
export function useDeferredUnmount(open: boolean, ms = 300): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);

  return mounted;
}
