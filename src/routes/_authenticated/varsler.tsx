import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useSuspenseQuery,
  queryOptions,
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect } from "react";
import {
  Bell,
  Heart,
  MessageCircle,
  Repeat2,
  UserPlus,
  UserCheck,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/brand/AppShell";
import { supabase } from "@/integrations/supabase/client";
import {
  listNotifications,
  markNotificationsRead,
  type NotificationItem,
} from "@/lib/notifications.functions";
import {
  acceptFollowRequest,
  rejectFollowRequest,
} from "@/lib/follows.functions";

export const Route = createFileRoute("/_authenticated/varsler")({
  head: () => ({
    meta: [
      { title: "mittpunkt – Varsler" },
      { name: "description", content: "Dine varsler på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

const opts = (fn: () => Promise<NotificationItem[]>) =>
  queryOptions({
    queryKey: ["notifications"],
    queryFn: fn,
    staleTime: 30_000,
  });

function Page() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5">
        <h1 className="font-display text-3xl tracking-tight mb-6">Varsler</h1>
        <Suspense fallback={<Skeleton />}>
          <List />
        </Suspense>
      </div>
    </AppShell>
  );
}

function List() {
  const fetchList = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const { data } = useSuspenseQuery(opts(() => fetchList()));
  const qc = useQueryClient();

  useEffect(() => {
    markRead({ data: {} })
      .then(() => qc.invalidateQueries({ queryKey: ["unread-counts"] }))
      .catch(() => {});
  }, [markRead, qc]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const topic = `notif-list:${uid}:${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${uid}`,
          },
          () => qc.invalidateQueries({ queryKey: ["notifications"] }),
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  if (!data.length) {
    return (
      <div className="glass rounded-3xl p-10 text-center">
        <Bell className="h-8 w-8 mx-auto text-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">Ingen varsler ennå.</p>
      </div>
    );
  }

  const groups = groupByDate(data);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="font-display text-base text-muted-foreground mb-2 px-2">
            {g.label}
          </h2>
          <ul className="-mx-2">
            {g.items.map((n) => (
              <Row key={n.id} n={n} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ n }: { n: NotificationItem }) {
  const unread = !n.readAt;
  const isPostType =
    n.type === "like" || n.type === "comment" || n.type === "repost";
  const isRequest = n.type === "follow_request";
  const target = isPostType && n.post
    ? { to: "/post/$postId" as const, params: { postId: n.post.id } }
    : { to: "/u/$username" as const, params: { username: n.actor.username } };

  return (
    <li
      className={`flex items-center gap-3 px-2 py-2.5 rounded-xl transition ${
        unread ? "bg-[var(--color-notif-tint)]" : "hover:bg-white/5"
      }`}
    >
      <Link
        {...target}
        className="flex items-center gap-3 min-w-0 flex-1"
      >
        <div className="relative shrink-0">
          <Avatar url={n.actor.avatarUrl} name={n.actor.username} />
          <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-background grid place-items-center">
            <TypeIcon type={n.type} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-snug text-foreground">
            <span className="font-semibold">{n.actor.username}</span>{" "}
            <span className="text-foreground/90">{verbFor(n)}</span>
            {n.preview && (
              <span className="text-muted-foreground"> «{n.preview}»</span>
            )}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {formatRelative(new Date(n.createdAt))}
          </div>
        </div>
      </Link>
      {isRequest ? (
        <RequestActions actorId={n.actor.id} notificationId={n.id} />
      ) : n.post?.imageUrl ? (
        <Link {...target} className="shrink-0" aria-hidden tabIndex={-1}>
          <img
            src={n.post.imageUrl}
            alt=""
            className="h-11 w-11 rounded-md object-cover"
          />
        </Link>
      ) : n.post ? (
        <Link {...target} className="shrink-0" aria-hidden tabIndex={-1}>
          <div className="h-11 w-16 rounded-md bg-white/5 px-1.5 py-1 overflow-hidden">
            <p className="text-[10px] leading-tight text-muted-foreground line-clamp-3">
              {n.post.body}
            </p>
          </div>
        </Link>
      ) : null}
      {unread && !isRequest && (
        <span className="shrink-0 h-2 w-2 rounded-full bg-[var(--color-notif-dot)]" />
      )}
    </li>
  );
}

function RequestActions({
  actorId,
  notificationId,
}: {
  actorId: string;
  notificationId: string;
}) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(acceptFollowRequest);
  const rejectFn = useServerFn(rejectFollowRequest);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["follow-requests"] });
    qc.invalidateQueries({ queryKey: ["unread-counts"] });
  };

  const removeRow = () => {
    qc.setQueryData<NotificationItem[]>(["notifications"], (prev) =>
      (prev ?? []).filter((x) => x.id !== notificationId),
    );
  };

  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { requesterId: actorId } }),
    onMutate: removeRow,
    onSuccess: invalidate,
    onError: (e: Error) => {
      toast.error(e.message);
      invalidate();
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectFn({ data: { requesterId: actorId } }),
    onMutate: removeRow,
    onSuccess: invalidate,
    onError: (e: Error) => {
      toast.error(e.message);
      invalidate();
    },
  });

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => accept.mutate()}
        disabled={accept.isPending || reject.isPending}
        className="h-8 w-8 grid place-items-center rounded-full bg-foreground text-background hover:bg-foreground/90 transition disabled:opacity-60"
        aria-label="Godta"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => reject.mutate()}
        disabled={accept.isPending || reject.isPending}
        className="h-8 w-8 grid place-items-center rounded-full border border-white/15 hover:bg-white/5 transition disabled:opacity-60"
        aria-label="Avslå"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function verbFor(n: NotificationItem): string {
  switch (n.type) {
    case "like":
      return "likte innlegget ditt";
    case "comment":
      return "kommenterte innlegget ditt:";
    case "repost":
      return n.preview ? "reposta innlegget ditt:" : "reposta innlegget ditt";
    case "follow":
      return "begynte å følge deg";
    case "follow_request":
      return "har bedt om å følge deg";
    case "follow_accept":
      return "godtok forespørselen din";
  }
}

function TypeIcon({ type }: { type: NotificationItem["type"] }) {
  const cls = "h-3 w-3";
  switch (type) {
    case "like":
      return <Heart className={`${cls} text-[var(--color-notif-dot)] fill-[var(--color-notif-dot)]`} />;
    case "comment":
      return <MessageCircle className={`${cls} text-foreground`} />;
    case "repost":
      return <Repeat2 className={`${cls} text-[var(--color-online)]`} />;
    case "follow":
    case "follow_request":
      return <UserPlus className={`${cls} text-foreground`} />;
    case "follow_accept":
      return <UserCheck className={`${cls} text-[var(--color-online)]`} />;
  }
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-11 w-11 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="h-11 w-11 rounded-full bg-white/10 grid place-items-center text-sm font-medium">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-2 py-2.5 flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-white/10" />
            <div className="h-3 w-1/3 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByDate(items: NotificationItem[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const groups: Record<string, NotificationItem[]> = {
    "I dag": [],
    "Siste 7 dager": [],
    Eldre: [],
  };
  for (const n of items) {
    const age = now - new Date(n.createdAt).getTime();
    if (age < day) groups["I dag"].push(n);
    else if (age < 7 * day) groups["Siste 7 dager"].push(n);
    else groups["Eldre"].push(n);
  }
  return (["I dag", "Siste 7 dager", "Eldre"] as const)
    .map((label) => ({ label, items: groups[label] }))
    .filter((g) => g.items.length);
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
