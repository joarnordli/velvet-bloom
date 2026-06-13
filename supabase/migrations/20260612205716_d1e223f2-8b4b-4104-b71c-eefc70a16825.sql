
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('like','comment','repost','follow')),
  post_id uuid NULL,
  comment_id uuid NULL,
  preview text NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON public.notifications (recipient_id) WHERE read_at IS NULL;

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipient can read own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

CREATE POLICY "recipient can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "recipient can delete own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (recipient_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ===== Triggers =====

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  SELECT author_id INTO author FROM public.posts WHERE id = NEW.post_id;
  IF author IS NULL OR author = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, post_id)
  VALUES (author, NEW.user_id, 'like', NEW.post_id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_like
  AFTER INSERT ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

CREATE OR REPLACE FUNCTION public.unnotify_on_unlike()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE type='like' AND post_id = OLD.post_id AND actor_id = OLD.user_id;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_unnotify_on_unlike
  AFTER DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.unnotify_on_unlike();

CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  SELECT author_id INTO author FROM public.posts WHERE id = NEW.post_id;
  IF author IS NULL OR author = NEW.author_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, post_id, comment_id, preview)
  VALUES (author, NEW.author_id, 'comment', NEW.post_id, NEW.id, left(NEW.body, 140));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

CREATE OR REPLACE FUNCTION public.notify_on_repost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  IF NEW.repost_of IS NULL THEN RETURN NEW; END IF;
  SELECT author_id INTO author FROM public.posts WHERE id = NEW.repost_of;
  IF author IS NULL OR author = NEW.author_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, post_id, preview)
  VALUES (author, NEW.author_id, 'repost', NEW.repost_of,
          CASE WHEN length(trim(NEW.body)) > 0 THEN left(NEW.body, 140) ELSE NULL END);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_repost
  AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_repost();

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.follower_id = NEW.following_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type)
  VALUES (NEW.following_id, NEW.follower_id, 'follow');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_follow
  AFTER INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow();
