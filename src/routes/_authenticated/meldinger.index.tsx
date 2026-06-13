import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useSuspenseQuery,
  queryOptions,
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useState } from "react";
import { MessageCircle, Pin, Check, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/brand/AppShell";
import { supabase } from "@/integrations/supabase/client";
import {
  listConversations,
  acceptMessageRequest,
  declineMessageRequest,
  type ConversationListItem,
} from "@/lib/messages.functions";

export const Route = createFileRoute("/_authenticated/meldinger/")({
  head: () => ({
    meta: [
      { title: "mittpunkt – Meldinger" },
      { name: "description", content: "Dine samtaler på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Inbox,
});

type Tab = "chats" | "requests";

const inboxOpts = (
  tab: Tab,
  fn: () => Promise<ConversationListItem[]>,
) =>
  queryOptions({
    queryKey: ["conversations", tab],
    queryFn: fn,
    staleTime: 60_000,
  });

function Inbox() {
  const [tab, setTab] = useState<Tab>("chats");
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5">
        <h1 className="font-display text-3xl tracking-tight mb-4">Meldinger</h1>
        <div className="flex p-1 rounded-full bg-white/5 max-w-sm mb-4">
          <TabButton active={tab === "chats"} onClick={() => setTab("chats")}>
            Samtaler
          </TabButton>
          <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
            Forespørsler <RequestBadge />
          </TabButton>
        </div>
        <Suspense fallback={<InboxSkeleton />}>
          <InboxList tab={tab} />
        </Suspense>
      </div>
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-1.5 text-sm rounded-full transition ${
        active ? "bg-white/10 text-foreground" : "text-foreground/60"
      }`}
    >
      {children}
    </button>
  );
}

function RequestBadge() {
  const qc = useQueryClient();
  const counts = qc.getQueryData<{ messageRequests?: number }>(["unread-counts"]);
  const n = counts?.messageRequests ?? 0;
  if (!n) return null;
  return (
    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--color-online)] text-background">
      {n}
    </span>
  );
}

function InboxList({ tab }: { tab: Tab }) {
  const fetchInbox = useServerFn(listConversations);
  const { data } = useSuspenseQuery(
    inboxOpts(tab, () => fetchInbox({ data: { tab } })),
  );
  const qc = useQueryClient();

  useEffect(() => {
    const ids = data.map((c) => c.id);
    if (!ids.length) return;
    const channel = supabase
      .channel(`inbox-watch:${tab}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=in.(${ids.join(",")})`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=in.(${ids.join(",")})`,
        },
        () => qc.invalidateQueries({ queryKey: ["conversations"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, data, tab]);

  if (!data.length) {
    return (
      <div className="glass rounded-3xl p-10 text-center">
        <MessageCircle className="h-8 w-8 mx-auto text-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">
          {tab === "chats"
            ? "Ingen samtaler ennå. Trykk «Meld» på en profil for å starte en."
            : "Ingen meldingsforespørsler."}
        </p>
      </div>
    );
  }

  return (
    <ul className="-mx-2">
      {data.map((c) => (
        <ConversationRow key={c.id} c={c} tab={tab} />
      ))}
    </ul>
  );
}

function ConversationRow({ c, tab }: { c: ConversationListItem; tab: Tab }) {
  const others = c.participants.filter((p) => !p.isMe);
  const otherForDm = c.isGroup ? null : others[0];
  const title =
    c.title ??
    (c.isGroup
      ? others.map((p) => p.username).join(", ") || "Gruppesamtale"
      : otherForDm?.username ?? "Samtale");

  const preview = c.lastMessage
    ? c.lastMessage.body ?? (c.lastMessage.hasAttachment ? "📷 Bilde" : "")
    : "Ingen meldinger ennå";

  const time = new Date(c.lastMessageAt);
  const timeLabel = formatRelative(time);
  const unread = c.unreadCount > 0;
  const pinned = !!c.pinnedAt;

  return (
    <li>
      <Link
        to="/meldinger/$conversationId"
        params={{ conversationId: c.id }}
        className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/5 transition"
      >
        <Avatar url={otherForDm?.avatarUrl ?? null} name={title} />
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[15px] leading-tight ${
              unread ? "font-semibold text-foreground" : "font-medium text-foreground"
            }`}
          >
            {title}
            {c.isMyRequest && tab === "chats" && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                forespørsel sendt
              </span>
            )}
          </div>
          <div
            className={`truncate text-[13px] leading-tight mt-0.5 ${
              unread ? "text-foreground font-medium" : "text-muted-foreground"
            }`}
          >
            <span className="truncate">{preview}</span>
            <span className="text-muted-foreground"> · {timeLabel}</span>
          </div>
        </div>
        {tab === "requests" ? (
          <RequestActions conversationId={c.id} />
        ) : (
          <>
            {pinned && !unread && (
              <Pin className="shrink-0 h-3.5 w-3.5 text-muted-foreground rotate-45" />
            )}
            {unread && (
              <span
                className="shrink-0 h-2.5 w-2.5 rounded-full bg-[var(--color-online)]"
                aria-label={`${c.unreadCount} uleste`}
              />
            )}
          </>
        )}
      </Link>
    </li>
  );
}

function RequestActions({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(acceptMessageRequest);
  const declineFn = useServerFn(declineMessageRequest);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["unread-counts"] });
  };

  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { conversationId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const decline = useMutation({
    mutationFn: () => declineFn({ data: { conversationId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          accept.mutate();
        }}
        disabled={accept.isPending || decline.isPending}
        className="h-8 w-8 grid place-items-center rounded-full bg-foreground text-background hover:bg-foreground/90 transition disabled:opacity-60"
        aria-label="Godta forespørsel"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          decline.mutate();
        }}
        disabled={accept.isPending || decline.isPending}
        className="h-8 w-8 grid place-items-center rounded-full border border-white/15 hover:bg-white/5 transition disabled:opacity-60"
        aria-label="Avslå"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-11 w-11 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div className="h-11 w-11 rounded-full bg-white/10 grid place-items-center text-sm font-medium shrink-0">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-2 py-2.5 flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-white/10" />
            <div className="h-3 w-2/3 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "nå";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}t`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" });
}
