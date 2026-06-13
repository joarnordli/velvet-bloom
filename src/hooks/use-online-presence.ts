import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks the number of users currently in a live session via Supabase Realtime
 * presence. Module-scoped channel + ref-counted subscribers so React StrictMode
 * (and multiple mounts) don't try to add presence callbacks to an already-
 * subscribed channel.
 */
type SupabaseChannel = ReturnType<typeof supabase.channel>;
let sharedChannel: SupabaseChannel | null = null;
let subscriberCount = 0;
const listeners = new Set<(n: number) => void>();
let lastCount = 0;

function broadcast(n: number) {
  lastCount = n;
  for (const l of listeners) l(n);
}

export function useOnlinePresence(): number {
  const [count, setCount] = useState(lastCount);

  useEffect(() => {
    let cancelled = false;
    listeners.add(setCount);
    subscriberCount += 1;

    (async () => {
      if (cancelled) return;
      if (sharedChannel) return; // already set up by another mount

      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId || cancelled || sharedChannel) return;

      const channel = supabase.channel("online-users", {
        config: { presence: { key: userId } },
      });
      sharedChannel = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        broadcast(Object.keys(state).length);
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    })();

    return () => {
      cancelled = true;
      listeners.delete(setCount);
      subscriberCount -= 1;
      if (subscriberCount <= 0 && sharedChannel) {
        const c = sharedChannel;
        sharedChannel = null;
        supabase.removeChannel(c);
        lastCount = 0;
      }
    };
  }, []);

  return count;
}
