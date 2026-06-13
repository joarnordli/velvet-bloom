import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getUnreadCounts } from "@/lib/notifications.functions";

export function useUnreadCounts() {
  const fetchCounts = useServerFn(getUnreadCounts);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["unread-counts"],
    queryFn: () => fetchCounts(),
    staleTime: 30_000,
  });

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id ?? null;
      if (!userId || cancelled) return;

      // Unique topic per mount avoids supabase reusing an already-subscribed
      // channel object (which throws "cannot add postgres_changes callbacks
      // after subscribe()").
      const topic = `unread:${userId}:${Math.random().toString(36).slice(2, 8)}`;
      const invalidate = () =>
        qc.invalidateQueries({ queryKey: ["unread-counts"] });

      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${userId}`,
          },
          invalidate,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          invalidate,
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "conversation_participants",
            filter: `user_id=eq.${userId}`,
          },
          invalidate,
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  return query.data ?? { notifications: 0, messages: 0, messageRequests: 0 };
}
