
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Likes
CREATE TABLE public.post_likes (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.post_likes TO authenticated;
GRANT ALL ON public.post_likes TO service_role;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read likes" ON public.post_likes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own like" ON public.post_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own like" ON public.post_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX post_likes_post_id_idx ON public.post_likes(post_id);

-- Comments
CREATE TABLE public.post_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_comments TO authenticated;
GRANT ALL ON public.post_comments TO service_role;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read comments" ON public.post_comments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own comment" ON public.post_comments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Users can update own comment" ON public.post_comments
  FOR UPDATE TO authenticated USING (auth.uid() = author_id) WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Users can delete own comment" ON public.post_comments
  FOR DELETE TO authenticated USING (auth.uid() = author_id);
CREATE INDEX post_comments_post_id_created_idx ON public.post_comments(post_id, created_at DESC);

-- Search index on existing posts.body
CREATE INDEX posts_body_trgm_idx ON public.posts USING gin (body extensions.gin_trgm_ops);
