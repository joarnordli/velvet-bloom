import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime privacy/follow changes that affect a visited
 * profile and invalidate the relevant caches so the UI re-renders.
 *
 * - user_privacy_settings UPDATE/INSERT for the visited user
 *   (target flips private/public, changes audiences)
 * - follow_requests changes between viewer and target
 *   (target accepts/rejects — request row is deleted)
 * - follows INSERT/DELETE between viewer and target
 */
export function useProfileRealtime(opts: {
  targetUserId: string | undefined;
  viewerId: string | undefined;
  username: string;
}) {
  const { targetUserId, viewerId, username } = opts;
  const qc = useQueryClient();

  useEffect(() => {
    if (!targetUserId) return;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["user-profile", username] });
      qc.invalidateQueries({ queryKey: ["user-posts", username] });
      qc.invalidateQueries({ queryKey: ["dm-status", username] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    };

    const channel = supabase
      .channel(`profile-rt-${targetUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_privacy_settings",
          filter: `user_id=eq.${targetUserId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "follows",
          filter: `following_id=eq.${targetUserId}`,
        },
        (payload) => {
          const row =
            (payload.new as { follower_id?: string } | null) ??
            (payload.old as { follower_id?: string } | null);
          if (!viewerId || row?.follower_id === viewerId) invalidate();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "follow_requests",
          filter: `target_id=eq.${targetUserId}`,
        },
        (payload) => {
          const row =
            (payload.new as { requester_id?: string } | null) ??
            (payload.old as { requester_id?: string } | null);
          if (!viewerId || row?.requester_id === viewerId) invalidate();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetUserId, viewerId, username, qc]);
}
