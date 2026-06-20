ALTER TABLE "posts" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "repost_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill the denormalized counters from existing rows (one-time, idempotent).
UPDATE "posts" p SET "like_count" = (SELECT count(*) FROM "post_likes" pl WHERE pl."post_id" = p."id");--> statement-breakpoint
UPDATE "posts" p SET "comment_count" = (SELECT count(*) FROM "post_comments" pc WHERE pc."post_id" = p."id");--> statement-breakpoint
UPDATE "posts" p SET "repost_count" = (SELECT count(*) FROM "posts" r WHERE r."repost_of" = p."id");