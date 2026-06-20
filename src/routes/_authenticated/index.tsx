import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Suspense, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/brand/AppShell";
import { FeedHeader } from "@/components/brand/FeedHeader";
import { PostCard } from "@/components/brand/PostCard";
import { EmptyFeed } from "@/components/brand/EmptyFeed";
import { getFeedPosts, type FeedPage } from "@/lib/posts.functions";

const feedSearchSchema = z.object({
  view: fallback(z.enum(["anbefalt", "folger"]), "anbefalt").default("anbefalt"),
});

export type FeedView = z.infer<typeof feedSearchSchema>["view"];

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: zodValidator(feedSearchSchema),
  loaderDeps: ({ search }) => ({ view: search.view }),
  head: () => ({
    meta: [
      { title: "mittpunkt – Hjem" },
      { name: "description", content: "Din kuraterte feed på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="px-5">
          <FeedHeader />
        </div>
        <Suspense fallback={<FeedSkeleton />}>
          <Feed />
        </Suspense>
      </div>
    </AppShell>
  );
}

function Feed() {
  const { view } = Route.useSearch();
  const fetchFeed = useServerFn(getFeedPosts);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery({
      queryKey: ["feed", view],
      queryFn: ({ pageParam }) => fetchFeed({ data: { view, cursor: pageParam } }),
      initialPageParam: null as string | null,
      getNextPageParam: (last: FeedPage) => last.nextCursor ?? undefined,
    });

  const posts = data.pages.flatMap((p) => p.posts);

  // Preload the next page ~1 screen before the bottom. The scroller is
  // AppFrame's inner <main>, which fills the viewport, so root:null works.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root: null, rootMargin: "0px 0px 600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (posts.length === 0 && !hasNextPage) return <EmptyFeed />;

  return (
    <div>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
        </div>
      )}
      {!hasNextPage && posts.length > 0 && (
        <p className="py-8 text-center text-xs text-muted-foreground">Du er à jour</p>
      )}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="pt-2 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-white/5 pb-5">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="h-9 w-9 rounded-full bg-white/8" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 rounded bg-white/8" />
              <div className="h-2 w-12 rounded bg-white/5" />
            </div>
          </div>
          <div className="px-4 space-y-2">
            <div className="h-3 w-[85%] rounded bg-white/8" />
            <div className="h-3 w-[60%] rounded bg-white/8" />
          </div>
          <div className="flex items-center gap-5 px-4 pt-4">
            <div className="h-5 w-10 rounded bg-white/5" />
            <div className="h-5 w-10 rounded bg-white/5" />
            <div className="h-5 w-10 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
