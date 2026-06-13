
-- 1. user_privacy_settings extensions
ALTER TABLE public.user_privacy_settings
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_engagement_from public.dm_audience NOT NULL DEFAULT 'everyone';

-- 2. follow_requests
CREATE TABLE IF NOT EXISTS public.follow_requests (
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS follow_requests_target_idx ON public.follow_requests(target_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_requests TO authenticated;
GRANT ALL ON public.follow_requests TO service_role;

ALTER TABLE public.follow_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fr_select ON public.follow_requests;
CREATE POLICY fr_select ON public.follow_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR target_id = auth.uid());

DROP POLICY IF EXISTS fr_insert ON public.follow_requests;
CREATE POLICY fr_insert ON public.follow_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

DROP POLICY IF EXISTS fr_delete ON public.follow_requests;
CREATE POLICY fr_delete ON public.follow_requests FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR target_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_requests;

-- 3. conversations.is_request
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_request boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS conversations_request_idx ON public.conversations(is_request) WHERE is_request = true;

-- 4. notifications: extend allowed types
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['like','comment','repost','follow','follow_request','follow_accept']));

-- 5. Helper functions
CREATE OR REPLACE FUNCTION public.follows_user(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.follows WHERE follower_id = _a AND following_id = _b);
$$;

CREATE OR REPLACE FUNCTION public.is_mutual(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.follows_user(_a, _b) AND public.follows_user(_b, _a);
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE priv boolean;
BEGIN
  IF _viewer = _target THEN RETURN true; END IF;
  SELECT COALESCE(is_private, false) INTO priv
    FROM public.user_privacy_settings WHERE user_id = _target;
  IF NOT COALESCE(priv, false) THEN RETURN true; END IF;
  RETURN public.follows_user(_viewer, _target);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_engage(_viewer uuid, _author uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  aud public.dm_audience;
  blocked boolean;
BEGIN
  IF _viewer = _author THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _author AND blocked_id = _viewer)
       OR (blocker_id = _viewer AND blocked_id = _author)
  ) INTO blocked;
  IF blocked THEN RETURN false; END IF;

  -- Private accounts: only approved followers can engage
  IF NOT public.can_view_profile(_viewer, _author) THEN RETURN false; END IF;

  SELECT COALESCE(allow_engagement_from, 'everyone'::public.dm_audience)
    INTO aud
    FROM public.user_privacy_settings WHERE user_id = _author;
  aud := COALESCE(aud, 'everyone'::public.dm_audience);

  IF aud = 'everyone' THEN RETURN true; END IF;
  IF aud = 'nobody'   THEN RETURN false; END IF;
  IF aud = 'followers' THEN
    RETURN public.follows_user(_author, _viewer) OR public.follows_user(_viewer, _author);
  END IF;
  IF aud = 'mutuals' THEN
    RETURN public.is_mutual(_viewer, _author);
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_status(_sender uuid, _recipient uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  audience public.dm_audience;
  blocked boolean;
  follows_sender boolean;
  follows_recipient boolean;
BEGIN
  IF _sender = _recipient THEN RETURN 'allowed'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _recipient AND blocked_id = _sender)
       OR (blocker_id = _sender AND blocked_id = _recipient)
  ) INTO blocked;
  IF blocked THEN RETURN 'blocked'; END IF;

  SELECT COALESCE(allow_dm_from, 'everyone'::public.dm_audience)
    INTO audience
    FROM public.user_privacy_settings WHERE user_id = _recipient;
  audience := COALESCE(audience, 'everyone'::public.dm_audience);

  follows_sender    := public.follows_user(_recipient, _sender);
  follows_recipient := public.follows_user(_sender, _recipient);

  IF audience = 'everyone' THEN RETURN 'allowed'; END IF;
  IF audience = 'followers' AND (follows_sender OR follows_recipient) THEN RETURN 'allowed'; END IF;
  IF audience = 'mutuals' AND follows_sender AND follows_recipient THEN RETURN 'allowed'; END IF;
  IF audience = 'nobody' THEN
    -- Sender may still request if they follow recipient; otherwise blocked
    IF follows_recipient THEN RETURN 'request'; ELSE RETURN 'blocked'; END IF;
  END IF;
  RETURN 'request';
END;
$$;

-- Keep can_dm in sync (used by older policies)
CREATE OR REPLACE FUNCTION public.can_dm(_sender uuid, _recipient uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.dm_status(_sender, _recipient) IN ('allowed', 'request');
$$;

-- 6. Posts SELECT policy with private-account gate
DROP POLICY IF EXISTS "Authenticated can read posts" ON public.posts;
CREATE POLICY "Authenticated can read posts" ON public.posts FOR SELECT TO authenticated
  USING (
    author_id = auth.uid()
    OR NOT COALESCE(
      (SELECT is_private FROM public.user_privacy_settings WHERE user_id = author_id),
      false
    )
    OR public.follows_user(auth.uid(), author_id)
  );

-- 7. Engagement gates on likes / comments / reposts
DROP POLICY IF EXISTS "Users can insert own like" ON public.post_likes;
CREATE POLICY "Users can insert own like" ON public.post_likes FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.can_engage(auth.uid(), (SELECT author_id FROM public.posts WHERE id = post_id))
  );

DROP POLICY IF EXISTS "Users can insert own comment" ON public.post_comments;
CREATE POLICY "Users can insert own comment" ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND public.can_engage(auth.uid(), (SELECT author_id FROM public.posts WHERE id = post_id))
  );

DROP POLICY IF EXISTS "Users can insert own posts" ON public.posts;
CREATE POLICY "Users can insert own posts" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND (
      repost_of IS NULL
      OR public.can_engage(auth.uid(), (SELECT author_id FROM public.posts p2 WHERE p2.id = repost_of))
    )
  );

-- 8. Messages INSERT: enforce one-message request rule
DROP POLICY IF EXISTS msg_insert ON public.messages;
CREATE POLICY msg_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.is_group)
      OR EXISTS (
        SELECT 1 FROM public.conversation_participants p
         WHERE p.conversation_id = messages.conversation_id
           AND p.user_id <> auth.uid()
           AND p.left_at IS NULL
           AND public.can_dm(auth.uid(), p.user_id)
      )
    )
    AND (
      -- If the conversation is in request state, the request initiator
      -- (= conversation.created_by) may only send one message until recipient accepts.
      NOT EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id = conversation_id
           AND c.is_request = true
           AND c.created_by = auth.uid()
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.messages m
         WHERE m.conversation_id = messages.conversation_id
           AND m.sender_id = auth.uid()
      )
    )
  );
