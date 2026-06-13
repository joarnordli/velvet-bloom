import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Image as ImageIcon, Send, X, Loader2, MoreVertical, Pin, PinOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { uploadMessageImage, type UploadedMessageImage } from "@/lib/upload-message-image";
import {
  getConversation,
  listMessages,
  sendMessage,
  markRead,
  setConversationPin,
  leaveConversation,
  acceptMessageRequest,
  declineMessageRequest,
  type ChatMessage,
  type ConversationDetail,
} from "@/lib/messages.functions";


export const Route = createFileRoute("/_authenticated/meldinger/$conversationId")({
  head: () => ({
    meta: [
      { title: "mittpunkt – Samtale" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Thread,
  errorComponent: ThreadError,
  notFoundComponent: ThreadNotFound,
});

function ThreadShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh text-foreground">
      <main className="md:pl-[17rem]">{children}</main>
    </div>
  );
}


function ThreadError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <ThreadShell>
      <div className="mx-auto max-w-2xl px-5 pt-28 md:pt-10 pb-10 text-center">
        <p className="text-sm text-muted-foreground mb-4">
          {error.message || "Noe gikk galt."}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="h-9 px-4 rounded-full border border-white/10 text-sm hover:bg-white/5"
          >
            Prøv igjen
          </button>
          <Link
            to="/meldinger"
            className="h-9 px-4 rounded-full border border-white/10 text-sm hover:bg-white/5 inline-flex items-center"
          >
            Til innboks
          </Link>
        </div>
      </div>
    </ThreadShell>
  );
}

function ThreadNotFound() {
  return (
    <ThreadShell>
      <div className="mx-auto max-w-2xl px-5 pt-28 md:pt-10 pb-10 text-center">
        <p className="text-sm text-muted-foreground mb-4">Samtale finnes ikke.</p>
        <Link
          to="/meldinger"
          className="h-9 px-4 rounded-full border border-white/10 text-sm hover:bg-white/5 inline-flex items-center"
        >
          Til innboks
        </Link>
      </div>
    </ThreadShell>
  );
}

const convOpts = (id: string, fn: () => Promise<ConversationDetail>) =>
  queryOptions({ queryKey: ["conversation", id], queryFn: fn });

const messagesOpts = (id: string, fn: () => Promise<ChatMessage[]>) =>
  queryOptions({ queryKey: ["messages", id], queryFn: fn });

function Thread() {
  const { conversationId } = Route.useParams();
  return (
    <ThreadShell>
      <div
        className="mx-auto max-w-2xl flex flex-col h-[100dvh] pt-[env(safe-area-inset-top)]"
      >
        <Suspense fallback={<ThreadSkeleton />}>
          <ThreadInner conversationId={conversationId} />
        </Suspense>
      </div>
    </ThreadShell>
  );
}

type Pending = {
  id: string;
  file: File;
  previewUrl: string;
  uploaded?: UploadedMessageImage;
  error?: string;
};

function ThreadInner({ conversationId }: { conversationId: string }) {
  const fetchConv = useServerFn(getConversation);
  const fetchMsgs = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const mark = useServerFn(markRead);
  const pinFn = useServerFn(setConversationPin);
  const leaveFn = useServerFn(leaveConversation);
  const acceptReqFn = useServerFn(acceptMessageRequest);
  const declineReqFn = useServerFn(declineMessageRequest);
  const qc = useQueryClient();
  const navigate = useNavigate();


  const { data: conv } = useSuspenseQuery(
    convOpts(conversationId, () => fetchConv({ data: { conversationId } })),
  );
  const { data: messages } = useSuspenseQuery(
    messagesOpts(conversationId, () => fetchMsgs({ data: { conversationId } })),
  );

  const me = conv.participants.find((p) => p.isMe);
  const others = conv.participants.filter((p) => !p.isMe && p.leftAt === null);
  const otherForDm = conv.isGroup ? null : others[0];
  const title =
    conv.title ??
    (conv.isGroup
      ? others.map((p) => p.username).join(", ") || "Gruppesamtale"
      : otherForDm?.username ?? "Samtale");

  // Mark read on mount + when a NEW message arrives. Tracking the latest
  // message id (not messages.length) avoids an extra write on every render
  // where the array reference changes but the tail is unchanged.
  const latestMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    void mark({ data: { conversationId } })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .catch(() => {});
  }, [conversationId, latestMessageId, mark, qc]);


  // Realtime: new messages + read-receipt updates + typing broadcast
  const broadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});

  useEffect(() => {
    const channel = supabase
      .channel(`conv:${conversationId}`, {
        config: { broadcast: { self: false } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["messages", conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          // last_read_at moved → refresh "Sett" indicator
          qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
        },
      )
      .on("broadcast", { event: "typing" }, (msg) => {
        const payload = msg.payload as { userId: string };
        if (!payload?.userId || payload.userId === me?.id) return;
        setTypingUsers((prev) => ({ ...prev, [payload.userId]: Date.now() }));
      })
      .subscribe();

    broadcastRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      broadcastRef.current = null;
    };
  }, [conversationId, qc, me?.id]);

  // Sweep stale typing indicators (>3s old)
  useEffect(() => {
    const i = window.setInterval(() => {
      setTypingUsers((prev) => {
        const cutoff = Date.now() - 3000;
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, t] of Object.entries(prev)) {
          if (t > cutoff) next[k] = t;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => window.clearInterval(i);
  }, []);

  const typingNames = Object.keys(typingUsers)
    .map((uid) => conv.participants.find((p) => p.id === uid)?.username)
    .filter((n): n is string => !!n);

  // ---- Bottom-anchored scroll (iMessage/WhatsApp behavior) ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const initialAnchoredRef = useRef(false);
  const [showNewPill, setShowNewPill] = useState(false);
  const prevMsgCountRef = useRef(messages.length);

  const stickToBottom = (force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
      setShowNewPill(false);
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distFromBottom < 80;
    if (isAtBottomRef.current && showNewPill) setShowNewPill(false);
  };

  // First open: jump to bottom (and again next frame for late layout).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || initialAnchoredRef.current) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    initialAnchoredRef.current = true;
    requestAnimationFrame(() => {
      const e2 = scrollRef.current;
      if (e2) e2.scrollTop = e2.scrollHeight;
    });
  }, []);

  // Late image/font reflows — keep glued to bottom if user was there.
  useEffect(() => {
    const target = contentRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => stickToBottom());
    ro.observe(target);
    return () => ro.disconnect();
  }, []);

  // Composer state
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMut = useMutation({
    mutationFn: async (args: {
      body: string;
      attachments: UploadedMessageImage[];
    }) =>
      send({
        data: {
          conversationId,
          body: args.body || undefined,
          attachments: args.attachments.length
            ? args.attachments.map((a) => ({
                storagePath: a.storagePath,
                mime: a.mime,
                width: a.width,
                height: a.height,
              }))
            : undefined,
        },
      }),
    onSuccess: () => {
      setText("");
      setPending([]);
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  // Typing broadcast — throttled to once every 1.2s while user is typing
  const lastTypingRef = useRef(0);
  const broadcastTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current < 1200) return;
    lastTypingRef.current = now;
    void broadcastRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: me?.id },
    });
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const items: Pending[] = Array.from(files)
      .slice(0, 10 - pending.length)
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    setPending((prev) => [...prev, ...items]);

    // Upload in parallel; mark each item as uploaded/failed
    await Promise.all(
      items.map(async (item) => {
        try {
          const uploaded = await uploadMessageImage(item.file, conversationId);
          setPending((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, uploaded } : p)),
          );
        } catch (e) {
          setPending((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, error: (e as Error).message }
                : p,
            ),
          );
          toast.error((e as Error).message);
        }
      }),
    );
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const canSubmit = (() => {
    if (sendMut.isPending) return false;
    const hasText = text.trim().length > 0;
    const allUploaded = pending.length > 0 && pending.every((p) => !!p.uploaded);
    if (pending.length > 0 && !allUploaded) return false;
    return hasText || allUploaded;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const uploaded = pending
      .map((p) => p.uploaded)
      .filter((x): x is UploadedMessageImage => !!x);
    sendMut.mutate({ body: text.trim(), attachments: uploaded });
  };

  // Read receipts: last own message + other DM participant's lastReadAt
  const lastOwn = [...messages].reverse().find((m) => m.senderId === me?.id);
  const otherReadAt = otherForDm
    ? new Date(otherForDm.lastReadAt).getTime()
    : 0;
  const lastOwnReadByOther =
    !!lastOwn && otherForDm && otherReadAt >= new Date(lastOwn.createdAt).getTime();

  // Stick to bottom whenever something below the fold changes height.
  // If user has scrolled up and a NEW message arrives, surface a pill instead.
  useLayoutEffect(() => {
    const grew = messages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (grew && !isAtBottomRef.current) {
      // Incoming message while scrolled up: don't jump, show pill.
      const last = messages[messages.length - 1];
      if (last && last.senderId !== me?.id) setShowNewPill(true);
      else stickToBottom(true); // own send always jumps
      return;
    }
    stickToBottom();
  }, [messages.length, typingNames.length, lastOwnReadByOther, pending.length, me?.id]);


  // Pin state derived from the cached inbox list (avoids extra round-trip)
  const inboxCache = qc.getQueryData<Array<{ id: string; pinnedAt: string | null }>>([
    "conversations",
  ]);
  const pinned = !!inboxCache?.find((x) => x.id === conversationId)?.pinnedAt;

  const pinMut = useMutation({
    mutationFn: (next: boolean) =>
      pinFn({ data: { conversationId, pinned: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => leaveFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/meldinger" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptReqMut = useMutation({
    mutationFn: () => acceptReqFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const declineReqMut = useMutation({
    mutationFn: () => declineReqFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["unread-counts"] });
      navigate({ to: "/meldinger" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Request gating
  const myMessageCount = messages.filter((m) => m.senderId === me?.id).length;
  const composerLocked =
    conv.isRequest && conv.isMyRequest && myMessageCount >= 1;
  const showRecipientBanner = conv.isRequest && !conv.isMyRequest;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate({ to: "/meldinger" })}
          className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/5 shrink-0"
          aria-label="Tilbake"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {otherForDm ? (
          <Link
            to="/u/$username"
            params={{ username: otherForDm.username }}
            className="flex items-center gap-3 min-w-0 hover:opacity-90 flex-1"
          >
            <Avatar url={otherForDm.avatarUrl} name={title} />
            <span className="font-display text-xl tracking-tight truncate">{title}</span>
          </Link>
        ) : (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar url={null} name={title} />
            <span className="font-display text-xl tracking-tight truncate">{title}</span>
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/5 shrink-0"
              aria-label="Mer"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => pinMut.mutate(!pinned)}>
              {pinned ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" /> Løsne
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" /> Fest samtale
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (confirm("Slette samtalen?")) deleteMut.mutate();
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Slett samtale
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>


      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-auto px-4 md:px-5 pt-4 pb-4 [overflow-anchor:none]"
        >
          <div ref={contentRef} className="space-y-2">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10">
            Si hei 👋
          </p>
        )}
        {messages.map((m, i) => {
          const isMe = m.senderId === me?.id;
          const prev = messages[i - 1];
          const sameSender = prev && prev.senderId === m.senderId;
          const isLastOwn = isMe && lastOwn?.id === m.id;
          return (
            <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${sameSender ? "mt-0.5" : "mt-2"}`}>
              {m.body && (
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    isMe
                      ? "bg-[var(--color-chat-me)] text-[var(--color-chat-me-foreground)]"
                      : "glass text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              )}
              {m.attachments.map((a) => (
                <img
                  key={a.id}
                  src={a.url}
                  alt=""
                  className={`rounded-xl max-h-72 w-auto ${m.body ? "mt-1" : ""}`}
                />
              ))}
              {isLastOwn && lastOwnReadByOther && (
                <span className="text-[10px] text-muted-foreground mt-0.5 mr-1">
                  Sett
                </span>
              )}
            </div>
          );

        })}

        {typingNames.length > 0 && (
          <div className="flex justify-start mt-2">
            <div className="glass rounded-2xl px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <TypingDots />
              <span>
                {typingNames.length === 1
                  ? `${typingNames[0]} skriver…`
                  : "Skriver…"}
              </span>
            </div>
          </div>
          )}
          </div>
        </div>

        {showNewPill && (
          <button
            type="button"
            onClick={() => stickToBottom(true)}
            className="absolute left-1/2 -translate-x-1/2 bottom-3 rounded-full px-3.5 py-1.5 text-xs font-medium bg-[var(--color-chat-me)] text-[var(--color-chat-me-foreground)] shadow-lg"
          >
            Ny melding ↓
          </button>
        )}
      </div>


      {showRecipientBanner && (
        <div className="border-t border-white/5 bg-[var(--color-notif-tint)] px-4 md:px-5 py-3 shrink-0 flex items-center gap-3">
          <p className="text-xs text-foreground/90 flex-1 leading-relaxed">
            <span className="font-medium">@{otherForDm?.username ?? "Brukeren"}</span>{" "}
            har sendt en meldingsforespørsel. Godta for å svare og flytte
            samtalen til innboksen.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => acceptReqMut.mutate()}
              disabled={acceptReqMut.isPending || declineReqMut.isPending}
              className="h-8 px-3 rounded-full text-xs bg-foreground text-background hover:bg-foreground/90 transition disabled:opacity-60"
            >
              Godta
            </button>
            <button
              type="button"
              onClick={() => declineReqMut.mutate()}
              disabled={acceptReqMut.isPending || declineReqMut.isPending}
              className="h-8 px-3 rounded-full text-xs border border-white/15 hover:bg-white/5 transition disabled:opacity-60"
            >
              Avslå
            </button>
          </div>
        </div>
      )}

      {composerLocked && (
        <div className="border-t border-white/5 bg-background px-4 md:px-5 py-3 shrink-0 text-center text-xs text-muted-foreground">
          Venter på at mottaker godtar forespørselen. Du kan ikke sende flere
          meldinger før det skjer.
        </div>
      )}

      {/* Composer */}
      {!showRecipientBanner && !composerLocked && (
      <form
        onSubmit={submit}
        className="relative z-10 px-3 md:px-5 py-3 shrink-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {pending.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="relative h-16 w-16 shrink-0 rounded-lg overflow-hidden border border-white/10"
              >
                <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                {!p.uploaded && !p.error && (
                  <div className="absolute inset-0 bg-black/50 grid place-items-center">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                {p.error && (
                  <div className="absolute inset-0 bg-red-900/60 grid place-items-center text-[10px] px-1 text-center">
                    Feil
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-black/70 text-white"
                  aria-label="Fjern bilde"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="glass h-10 w-10 shrink-0 rounded-full hover:bg-white/10 grid place-items-center text-foreground/80 transition"
            aria-label="Legg ved bilde"
          >
            <ImageIcon className="h-5 w-5" />
          </button>

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              broadcastTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            rows={1}
            placeholder="Skriv en melding…"
            className="flex-1 resize-none glass rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-white/20 max-h-32"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-10 w-10 shrink-0 rounded-full bg-[var(--color-chat-me)] text-[var(--color-chat-me-foreground)] grid place-items-center disabled:opacity-40"
            aria-label="Send"
          >
            {sendMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
      )}
    </>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return <img src={url} alt="" className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <div className="h-9 w-9 rounded-full bg-white/10 grid place-items-center text-xs font-medium shrink-0">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.5">
      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
    </span>
  );
}

function ThreadSkeleton() {
  return (
    <div className="px-4 pt-28 md:pt-6 space-y-3">
      <div className="h-6 w-32 rounded bg-white/10" />
      <div className="h-10 w-2/3 rounded-2xl bg-white/5" />
      <div className="h-10 w-1/2 rounded-2xl bg-white/5 ml-auto" />
    </div>
  );
}
