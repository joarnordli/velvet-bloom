import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { getPostById, type FeedPost } from "@/lib/posts.functions";
import { AppShell } from "@/components/brand/AppShell";
import { PostCard } from "@/components/brand/PostCard";
import { CommentsList } from "@/components/brand/CommentsList";

export const Route = createFileRoute("/_authenticated/post/$postId")({
  head: () => ({
    meta: [
      { title: "Post – mittpunkt" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PostDetailPage,
  errorComponent: ErrorView,
  notFoundComponent: NotFoundView,
});

const postKey = (postId: string) => ["post", postId] as const;
const postOpts = (postId: string, fn: () => Promise<FeedPost | null>) =>
  queryOptions({ queryKey: postKey(postId), queryFn: fn });

function PostDetailPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingView />}>
        <PostDetailInner />
      </Suspense>
    </AppShell>
  );
}

function PostDetailInner() {
  const { postId } = Route.useParams();
  const router = useRouter();
  const fetchPost = useServerFn(getPostById);
  const { data: post } = useSuspenseQuery(
    postOpts(postId, () => fetchPost({ data: { postId } })),
  );

  if (!post) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted-foreground">
        Posten finnes ikke.
      </div>
    );
  }

  return (
    <div className="pb-24">
      <header className="flex items-center gap-3 px-5 h-12">
        <button
          onClick={() => router.history.back()}
          aria-label="Tilbake"
          className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </header>

      <PostCard post={post} hideCommentButton />

      <section className="mt-2">
        <h2 className="px-5 pt-4 pb-2 text-sm font-medium text-foreground/80">
          Kommentarer · {post.commentCount}
        </h2>
        <CommentsList postId={postId} />
      </section>
    </div>
  );
}

function LoadingView() {
  return <p className="px-5 py-10 text-sm text-muted-foreground">Laster…</p>;
}

function ErrorView({ error }: { error: Error }) {
  return (
    <AppShell>
      <p className="px-5 py-10 text-sm text-destructive">
        Kunne ikke laste post: {error.message}
      </p>
    </AppShell>
  );
}

function NotFoundView() {
  return (
    <AppShell>
      <p className="px-5 py-10 text-sm text-muted-foreground">Fant ikke posten.</p>
    </AppShell>
  );
}
