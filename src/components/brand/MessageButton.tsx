import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getOrCreateDm, getDmStatus } from "@/lib/messages.functions";

export function MessageButton({ username }: { username: string }) {
  const navigate = useNavigate();
  const create = useServerFn(getOrCreateDm);
  const statusFn = useServerFn(getDmStatus);

  const { data: statusRes } = useQuery({
    queryKey: ["dm-status", username],
    queryFn: () => statusFn({ data: { username } }),
    staleTime: 60_000,
  });
  const status = statusRes?.status ?? "allowed";

  const mut = useMutation({
    mutationFn: async () => create({ data: { username } }),
    onSuccess: ({ conversationId }) => {
      navigate({
        to: "/meldinger/$conversationId",
        params: { conversationId },
        replace: true,
      });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  if (status === "blocked") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm border border-white/10 text-foreground/40 cursor-not-allowed"
      >
        <MessageCircle className="h-4 w-4" />
        Meld
      </button>
    );
  }

  const isRequest = status === "request";

  return (
    <button
      type="button"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm border border-white/10 text-foreground hover:bg-white/5 transition disabled:opacity-60"
    >
      {mut.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isRequest ? (
        <Send className="h-4 w-4" />
      ) : (
        <MessageCircle className="h-4 w-4" />
      )}
      {isRequest ? "Send forespørsel" : "Meld"}
    </button>
  );
}
