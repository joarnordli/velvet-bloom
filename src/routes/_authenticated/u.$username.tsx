import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useRegisterRefresh } from "@/hooks/use-pull-to-refresh";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Lock } from "lucide-react";
import {
  getUserProfileByUsername,
  getUserPostsByUsername,
  type PublicProfile,
} from "@/lib/profiles.functions";
import type { FeedPost } from "@/lib/posts.functions";
import { AppShell } from "@/components/brand/AppShell";
import { PostCard } from "@/components/brand/PostCard";
import { FollowButton } from "@/components/brand/FollowButton";
import { MessageButton } from "@/components/brand/MessageButton";
import { useProfileRealtime } from "@/hooks/use-profile-realtime";
import { authClient } from "@/lib/auth-client";



export const Route = createFileRoute("/_authenticated/u/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} – mittpunkt` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UserProfilePage,
  errorComponent: ErrorView,
  notFoundComponent: NotFoundView,
});

const profileKey = (username: string) => ["user-profile", username] as const;
const postsKey = (username: string) => ["user-posts", username] as const;

const profileOpts = (
  username: string,
  fn: () => Promise<PublicProfile>,
) => queryOptions({ queryKey: profileKey(username), queryFn: fn });

const postsOpts = (
  username: string,
  fn: () => Promise<FeedPost[]>,
) => queryOptions({ queryKey: postsKey(username), queryFn: fn });

function UserProfilePage() {
  const { username } = Route.useParams();
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <header className="px-5 flex items-center gap-3 h-12">
          <Link
            to="/"
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/5 md:hidden"
            aria-label={`Tilbake fra @${username}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </header>

        <Suspense fallback={<div className="px-5 mt-8 h-40 animate-pulse opacity-40" />}>
          <ProfileBody username={username} />
        </Suspense>
      </div>
    </AppShell>
  );
}

function ProfileBody({ username }: { username: string }) {
  const fetchProfile = useServerFn(getUserProfileByUsername);
  const fetchPosts = useServerFn(getUserPostsByUsername);

  const { data: profile } = useSuspenseQuery(
    profileOpts(username, () => fetchProfile({ data: { username } })),
  );
  const { data: posts } = useSuspenseQuery(
    postsOpts(username, () => fetchPosts({ data: { username } })),
  );

  const qc = useQueryClient();
  useRegisterRefresh(() => {
    qc.invalidateQueries({ queryKey: profileKey(username) });
    qc.invalidateQueries({ queryKey: postsKey(username) });
  });

  const [viewerId, setViewerId] = useState<string | undefined>(undefined);
  useEffect(() => {
    authClient.getSession().then(({ data }) => setViewerId(data?.user?.id));
  }, []);
  useProfileRealtime({ targetUserId: profile.id, viewerId, username });


  const attrs = [
    profile.region,
    profile.gender,
    profile.situation,
    profile.looking_for,
    profile.orientation,
  ].filter((s): s is string => !!s && s.trim().length > 0);

  return (
    <div>
      <div className="px-5 mt-6">
        <div className="flex items-start gap-5">
          <div className="h-20 w-20 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-white/25 to-white/5 ring-1 ring-white/15">
            {profile.avatar_url && (
              <img
                src={profile.avatar_url}
                alt=""
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl truncate flex-1">@{profile.username}</h2>
              {profile.isMe && (
                <Link
                  to="/profile"
                  aria-label="Rediger profil"
                  className="shrink-0 h-9 w-9 grid place-items-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/5 transition"
                >
                  <Pencil className="h-4 w-4" />
                </Link>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground/80">{profile.followerCount}</span> følgere
              <span className="mx-1.5">·</span>
              <span className="font-semibold text-foreground/80">{profile.followingCount}</span> følger
            </p>
            {attrs.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">{attrs.join(" · ")}</p>
            )}
          </div>
        </div>

        {!profile.isMe && (
          <div className="mt-4 flex items-center gap-2">
            <FollowButton username={profile.username} />
            <MessageButton username={profile.username} />
          </div>
        )}

        {profile.bio?.trim() && (
          <p className="mt-5 whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
            {profile.bio}
          </p>
        )}

        {profile.kinks.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {profile.kinks.map((k) => (
              <span
                key={k}
                className="inline-flex items-center px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-foreground/90"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        <div className="border-t border-white/5 my-6" />
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Innlegg
        </p>
      </div>

      {profile.viewState === "locked" ? (
        <div className="mx-5 mt-2 rounded-3xl border border-white/10 p-8 text-center">
          <Lock className="h-6 w-6 mx-auto text-foreground/60" />
          <p className="mt-3 text-sm font-medium">Denne kontoen er privat</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Følg @{profile.username} for å se innleggene. Du må vente til
            forespørselen blir godtatt.
          </p>
        </div>
      ) : posts.length === 0 ? (
        <p className="px-5 mt-2 text-sm text-muted-foreground text-center">
          Ingen innlegg enda.
        </p>
      ) : (
        <div className="mt-2">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorView({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <AppShell>
      <div className="px-5 py-16 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Kunne ikke laste profilen.</p>
        <button
          onClick={() => {
            reset();
            router.invalidate();
          }}
          className="h-9 px-4 rounded-full text-sm border border-white/10 hover:bg-white/5"
        >
          Prøv igjen
        </button>
      </div>
    </AppShell>
  );
}

function NotFoundView() {
  const { username } = Route.useParams();
  return (
    <AppShell>
      <div className="px-5 py-16 text-center space-y-3">
        <p className="font-display text-2xl">Fant ikke @{username}</p>
        <Link to="/" className="inline-block text-sm text-foreground/70 hover:underline">
          Tilbake til feeden
        </Link>
      </div>
    </AppShell>
  );
}
