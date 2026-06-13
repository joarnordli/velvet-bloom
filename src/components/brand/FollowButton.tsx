import { UserPlus, UserCheck, Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  followUser,
  unfollowUser,
  cancelFollowRequest,
} from "@/lib/follows.functions";
import type { PublicProfile } from "@/lib/profiles.functions";

type Props = {
  username: string;
};

export function FollowButton({ username }: Props) {
  const qc = useQueryClient();
  const followFn = useServerFn(followUser);
  const unfollowFn = useServerFn(unfollowUser);
  const cancelFn = useServerFn(cancelFollowRequest);
  const [hover, setHover] = useState(false);

  const key = ["user-profile", username] as const;

  const mutation = useMutation({
    mutationFn: async (
      action: "follow" | "unfollow" | "cancel",
    ): Promise<{ next: "none" | "requested" | "following" }> => {
      if (action === "follow") {
        const res = await followFn({ data: { username } });
        return { next: res.status };
      }
      if (action === "unfollow") {
        await unfollowFn({ data: { username } });
        return { next: "none" };
      }
      await cancelFn({ data: { username } });
      return { next: "none" };
    },
    onMutate: async (action) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PublicProfile>(key);
      if (prev) {
        const optimistic: PublicProfile = { ...prev };
        if (action === "follow") {
          if (prev.isPrivate) {
            optimistic.followStatus = "requested";
          } else {
            optimistic.followStatus = "following";
            optimistic.isFollowing = true;
            optimistic.followerCount = prev.followerCount + 1;
            if (optimistic.viewState === "locked") optimistic.viewState = "unlocked";
          }
        } else {
          // unfollow or cancel
          optimistic.followStatus = "none";
          if (prev.isFollowing) {
            optimistic.isFollowing = false;
            optimistic.followerCount = Math.max(0, prev.followerCount - 1);
            if (prev.isPrivate) optimistic.viewState = "locked";
          }
        }
        qc.setQueryData<PublicProfile>(key, optimistic);
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["user-posts", username] });
      qc.invalidateQueries({ queryKey: ["follow-requests"] });
      qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });

  const profile = qc.getQueryData<PublicProfile>(key);
  const status = profile?.followStatus ?? "none";
  const pending = mutation.isPending;

  let label = "Følg";
  let Icon = UserPlus;
  let action: "follow" | "unfollow" | "cancel" = "follow";
  let cls =
    "bg-foreground text-background hover:bg-foreground/90";
  if (status === "following") {
    label = hover ? "Avfølg" : "Følger";
    Icon = UserCheck;
    action = "unfollow";
    cls =
      "border border-white/15 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive text-foreground/90";
  } else if (status === "requested") {
    label = hover ? "Avbryt" : "Forespurt";
    Icon = Clock;
    action = "cancel";
    cls =
      "border border-white/15 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive text-foreground/90";
  }

  return (
    <button
      onClick={() => mutation.mutate(action)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={pending}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition disabled:opacity-60 ${cls}`}
      aria-pressed={status !== "none"}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
