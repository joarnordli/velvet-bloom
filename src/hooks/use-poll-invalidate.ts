import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Polling replacement for the old Supabase Realtime `postgres_changes`
 * subscriptions. Invalidates the given query keys on a fixed interval so the UI
 * stays fresh without a live socket. This is the "polling first" step of the
 * realtime migration — a LISTEN/NOTIFY + WebSocket push is the documented
 * follow-up (see docs/migration-to-self-hosted.md §6).
 *
 * Pair with TanStack Query's `refetchOnWindowFocus` for snappier updates when
 * the user returns to the tab.
 */
export function usePollInvalidate(
  keys: QueryKey[],
  intervalMs: number,
  enabled = true,
): void {
  const qc = useQueryClient();
  // Serialize keys so the effect re-subscribes only when the set truly changes.
  const keysSig = JSON.stringify(keys);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      for (const key of keys) qc.invalidateQueries({ queryKey: key });
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, intervalMs, enabled, keysSig]);
}
