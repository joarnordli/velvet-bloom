ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_cp_user_pinned
  ON public.conversation_participants(user_id, pinned_at DESC)
  WHERE left_at IS NULL AND pinned_at IS NOT NULL;