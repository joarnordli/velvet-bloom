import { usePollInvalidate } from "./use-poll-invalidate";

/**
 * Keep a visited profile's caches fresh as privacy/follow state changes
 * (target flips private/public, accepts/rejects a request, follow added/removed).
 *
 * Was a Supabase Realtime subscription on user_privacy_settings / follows /
 * follow_requests; now a polling invalidation (the "polling first" realtime
 * step). The viewer-scoped filtering the socket did is unnecessary here — we
 * simply re-fetch the few profile-scoped queries on an interval.
 */
export function useProfileRealtime(opts: {
  targetUserId: string | undefined;
  viewerId: string | undefined;
  username: string;
}) {
  const { targetUserId, username } = opts;
  usePollInvalidate(
    [
      ["user-profile", username],
      ["user-posts", username],
      ["dm-status", username],
      ["feed"],
    ],
    15000,
    !!targetUserId,
  );
}
