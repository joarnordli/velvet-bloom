import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Suspense } from "react";
import { AppShell } from "@/components/brand/AppShell";
import { FeedHeader } from "@/components/brand/FeedHeader";
import { PostCard } from "@/components/brand/PostCard";
import { EmptyFeed } from "@/components/brand/EmptyFeed";
import { getFeedPosts, type FeedPost } from "@/lib/posts.functions";

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

const feedOptions = (
  view: FeedView,
  fn: (args: { data: { view: FeedView } }) => Promise<FeedPost[]>,
) =>
  queryOptions({
    queryKey: ["feed", view],
    queryFn: () => fn({ data: { view } }),
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
  const { data } = useSuspenseQuery(feedOptions(view, fetchFeed));

  if (!data.length) return <EmptyFeed />;

  return (
    <div>
      {data.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
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
