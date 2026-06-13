
-- ===== Enums =====
CREATE TYPE public.dm_audience AS ENUM ('everyone', 'followers', 'mutuals', 'nobody');

-- ===== Conversations =====
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group boolean NOT NULL DEFAULT false,
  title text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- ===== Participants =====
CREATE TABLE public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  muted boolean NOT NULL DEFAULT false,
  left_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_cp_user ON public.conversation_participants(user_id) WHERE left_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Helper (security definer to avoid recursive RLS on participants)
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
      AND left_at IS NULL
  );
$$;

-- ===== Messages =====
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ===== Attachments =====
CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime text NOT NULL,
  width int,
  height int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_message ON public.message_attachments(message_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_attachments TO authenticated;
GRANT ALL ON public.message_attachments TO service_role;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- ===== Privacy settings =====
CREATE TABLE public.user_privacy_settings (
  user_id uuid PRIMARY KEY,
  allow_dm_from public.dm_audience NOT NULL DEFAULT 'everyone',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_privacy_settings TO authenticated;
GRANT ALL ON public.user_privacy_settings TO service_role;
ALTER TABLE public.user_privacy_settings ENABLE ROW LEVEL SECURITY;

-- ===== Blocks =====
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON public.user_blocks(blocked_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- ===== Push subscriptions =====
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_user ON public.push_subscriptions(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ===== Notification prefs =====
CREATE TABLE public.notification_prefs (
  user_id uuid PRIMARY KEY,
  dm_push boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

-- ===== can_dm helper =====
CREATE OR REPLACE FUNCTION public.can_dm(_sender uuid, _recipient uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  audience public.dm_audience;
  is_blocked boolean;
  follows_sender boolean;
  follows_recipient boolean;
BEGIN
  IF _sender = _recipient THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _recipient AND blocked_id = _sender)
       OR (blocker_id = _sender   AND blocked_id = _recipient)
  ) INTO is_blocked;
  IF is_blocked THEN RETURN false; END IF;

  SELECT COALESCE(
    (SELECT allow_dm_from FROM public.user_privacy_settings WHERE user_id = _recipient),
    'everyone'::public.dm_audience
  ) INTO audience;

  IF audience = 'nobody'    THEN RETURN false; END IF;
  IF audience = 'everyone'  THEN RETURN true;  END IF;

  -- recipient follows sender => sender is a "follower" of recipient
  SELECT EXISTS (
    SELECT 1 FROM public.follows WHERE follower_id = _recipient AND following_id = _sender
  ) INTO follows_sender;

  SELECT EXISTS (
    SELECT 1 FROM public.follows WHERE follower_id = _sender AND following_id = _recipient
  ) INTO follows_recipient;

  IF audience = 'followers' THEN
    -- sender is followed by recipient OR sender follows recipient
    RETURN follows_sender OR follows_recipient;
  END IF;

  IF audience = 'mutuals' THEN
    RETURN follows_sender AND follows_recipient;
  END IF;

  RETURN false;
END;
$$;

-- ===== Policies =====

-- conversations: members can read; anyone authenticated can create (creator set to themselves); members can update last_message_at via trigger only
CREATE POLICY conv_select ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));
CREATE POLICY conv_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY conv_update ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_conversation_member(id, auth.uid()))
  WITH CHECK (public.is_conversation_member(id, auth.uid()));

-- participants: a member can see other members; self-leave allowed; anyone can be added by a member
CREATE POLICY cp_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY cp_insert_self ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());  -- inserting yourself when creating a conv
CREATE POLICY cp_insert_by_member ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY cp_update_self ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY cp_delete_self ON public.conversation_participants
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- messages: members can read; sender must be member; 1:1 first-message gated by can_dm
CREATE POLICY msg_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY msg_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
    AND (
      -- groups: any member can send
      EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.is_group)
      OR
      -- 1:1: must satisfy can_dm with the other participant
      EXISTS (
        SELECT 1 FROM public.conversation_participants p
        WHERE p.conversation_id = conversation_id
          AND p.user_id <> auth.uid()
          AND p.left_at IS NULL
          AND public.can_dm(auth.uid(), p.user_id)
      )
    )
  );
CREATE POLICY msg_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());
CREATE POLICY msg_delete_own ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- attachments: members can read; sender of the message can insert/delete
CREATE POLICY att_select ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );
CREATE POLICY att_insert ON public.message_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND m.sender_id = auth.uid()
    )
  );
CREATE POLICY att_delete ON public.message_attachments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND m.sender_id = auth.uid()
    )
  );

-- privacy: self-only
CREATE POLICY ups_select ON public.user_privacy_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY ups_upsert ON public.user_privacy_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY ups_update ON public.user_privacy_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- blocks: self-only
CREATE POLICY blocks_select ON public.user_blocks
  FOR SELECT TO authenticated USING (blocker_id = auth.uid());
CREATE POLICY blocks_insert ON public.user_blocks
  FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
CREATE POLICY blocks_delete ON public.user_blocks
  FOR DELETE TO authenticated USING (blocker_id = auth.uid());

-- push subscriptions: self-only
CREATE POLICY push_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY push_insert ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY push_update ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- notification prefs: self-only
CREATE POLICY np_select ON public.notification_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY np_upsert ON public.notification_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY np_update ON public.notification_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ===== Trigger: bump conversations.last_message_at =====
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_bump_conv_last_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_last_message();

-- ===== Realtime =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_attachments;
