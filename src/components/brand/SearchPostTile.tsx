import { Link } from "@tanstack/react-router";
import type { FeedPost } from "@/lib/posts.functions";

/**
 * Square tile for the discover grid. Image posts show the image only; text
 * posts render as a glass card with the body and the author handle.
 */
export function SearchPostTile({ post }: { post: FeedPost }) {
  const isImage = !!post.imageUrl;
  return (
    <Link
      to="/post/$postId"
      params={{ postId: post.id }}
      className="relative block aspect-square overflow-hidden bg-white/[0.03] focus:outline-none"
    >
      {isImage ? (
        <img
          src={post.imageUrl!}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-3 bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/5">
          <p className="text-[13px] leading-snug text-foreground/90 line-clamp-6 whitespace-pre-wrap break-words">
            {post.body}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            @{post.author.username}
          </p>
        </div>
      )}
    </Link>
  );
}
