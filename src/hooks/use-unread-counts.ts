import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUnreadCounts } from "@/lib/notifications.functions";

/**
 * Unread badge counts (notifications / messages / message requests).
 *
 * Was kept live by a Supabase Realtime subscription on notifications + messages
 * + conversation_participants; now polled via `refetchInterval` (the "polling
 * first" realtime step — a LISTEN/NOTIFY + WS push is the documented follow-up).
 */
export function useUnreadCounts() {
  const fetchCounts = useServerFn(getUnreadCounts);

  const query = useQuery({
    queryKey: ["unread-counts"],
    queryFn: () => fetchCounts(),
    staleTime: 15_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  return query.data ?? { notifications: 0, messages: 0, messageRequests: 0 };
}
