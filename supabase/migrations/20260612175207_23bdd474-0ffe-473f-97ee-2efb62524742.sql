
CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  conv_id uuid;
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF me = _other THEN RAISE EXCEPTION 'cannot dm self'; END IF;
  IF NOT public.can_dm(me, _other) THEN RAISE EXCEPTION 'not allowed'; END IF;

  SELECT c.id INTO conv_id
  FROM public.conversations c
  JOIN public.conversation_participants p1
    ON p1.conversation_id = c.id AND p1.user_id = me AND p1.left_at IS NULL
  JOIN public.conversation_participants p2
    ON p2.conversation_id = c.id AND p2.user_id = _other AND p2.left_at IS NULL
  WHERE c.is_group = false
  LIMIT 1;

  IF conv_id IS NOT NULL THEN
    RETURN conv_id;
  END IF;

  INSERT INTO public.conversations (is_group, created_by)
  VALUES (false, me)
  RETURNING id INTO conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (conv_id, me), (conv_id, _other);

  RETURN conv_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;
