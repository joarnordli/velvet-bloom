-- =====================================================================
-- Phase 0 — Trust hardening
--   1. Gate sensitive profile columns behind can_view_profile.
--   2. Enforce storage size / mime limits at the bucket level.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profile column privacy
--
-- Until now, `profiles` was SELECTable in full by every authenticated
-- user (`USING (true)`), so a private account's bio / kinks / orientation
-- / situation / looking_for / region / gender leaked to anyone logged in.
--
-- Identity columns (id, username, avatar_path, created_at) stay readable
-- because the rest of the app needs them everywhere (feeds, search,
-- notifications, DM participant lists). The sensitive columns are revoked
-- from direct SELECT and exposed only through a security-definer accessor
-- that applies the same `can_view_profile` gate used for posts.
-- ---------------------------------------------------------------------

-- NB: a column-level REVOKE does NOT subtract from a table-level GRANT SELECT.
-- To actually restrict columns we drop the blanket table SELECT and re-grant
-- SELECT on identity columns only. Sensitive columns are then reachable solely
-- through the gated get_profile_card RPC below.
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, username, avatar_path, created_at) ON public.profiles TO authenticated;

-- Gated accessor: returns identity always; returns detail fields only when
-- the caller is allowed to view the target (self, public account, or an
-- approved follower of a private account). Otherwise details come back NULL.
CREATE OR REPLACE FUNCTION public.get_profile_card(_target uuid)
RETURNS TABLE (
  id           uuid,
  username     text,
  avatar_path  text,
  created_at   timestamptz,
  region       text,
  gender       text,
  situation    text,
  looking_for  text,
  orientation  text,
  bio          text,
  kinks        text[],
  can_view     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.avatar_path,
    p.created_at,
    CASE WHEN g.allowed THEN p.region      ELSE NULL END,
    CASE WHEN g.allowed THEN p.gender       ELSE NULL END,
    CASE WHEN g.allowed THEN p.situation    ELSE NULL END,
    CASE WHEN g.allowed THEN p.looking_for  ELSE NULL END,
    CASE WHEN g.allowed THEN p.orientation  ELSE NULL END,
    CASE WHEN g.allowed THEN p.bio          ELSE NULL END,
    CASE WHEN g.allowed THEN p.kinks        ELSE '{}'::text[] END,
    g.allowed
  FROM public.profiles p
  CROSS JOIN LATERAL (
    SELECT public.can_view_profile(auth.uid(), p.id) AS allowed
  ) g
  WHERE p.id = _target;
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_card(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_card(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Storage hardening
--
-- The EXIF-strip + re-encode pipeline runs client-side, so a hostile
-- client could upload arbitrary bytes straight to Storage under the
-- per-folder RLS. Cap size and restrict mime types at the bucket level
-- so the privacy/abuse contract can't be bypassed from the network.
-- (UPDATE no-ops harmlessly if a bucket id is absent.)
-- ---------------------------------------------------------------------

UPDATE storage.buckets
SET
  file_size_limit   = 10485760, -- 10 MiB
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id IN ('post-media', 'message-media', 'avatars');
