
-- 1. Security-definer helpers exposing privacy flags safely
CREATE OR REPLACE FUNCTION public.is_account_private(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_private FROM public.user_privacy_settings WHERE user_id = _user),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_account_private(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_privacy_flags(uuids uuid[])
RETURNS TABLE (
  user_id uuid,
  is_private boolean,
  allow_engagement_from public.dm_audience,
  allow_dm_from public.dm_audience
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u AS user_id,
    COALESCE(s.is_private, false) AS is_private,
    COALESCE(s.allow_engagement_from, 'everyone'::public.dm_audience) AS allow_engagement_from,
    COALESCE(s.allow_dm_from, 'everyone'::public.dm_audience) AS allow_dm_from
  FROM unnest(uuids) AS u
  LEFT JOIN public.user_privacy_settings s ON s.user_id = u;
$$;

GRANT EXECUTE ON FUNCTION public.get_privacy_flags(uuid[]) TO authenticated;

-- 2. Rewrite posts SELECT policy to use the security-definer helper
DROP POLICY IF EXISTS "Authenticated can read posts" ON public.posts;
CREATE POLICY "Authenticated can read posts"
ON public.posts FOR SELECT
TO authenticated
USING (
  author_id = auth.uid()
  OR public.can_view_profile(auth.uid(), author_id)
);

-- 3. Fix posts INSERT policy typo on repost engagement check
DROP POLICY IF EXISTS "Users can insert own posts" ON public.posts;
CREATE POLICY "Users can insert own posts"
ON public.posts FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND (
    repost_of IS NULL
    OR public.can_engage(
      auth.uid(),
      (SELECT p2.author_id FROM public.posts p2 WHERE p2.id = posts.repost_of)
    )
  )
);

-- 4. Realtime for privacy settings
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_privacy_settings;
