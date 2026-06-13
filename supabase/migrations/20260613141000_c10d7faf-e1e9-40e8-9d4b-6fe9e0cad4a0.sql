-- =====================================================================
-- Phase 0b — lock SECURITY DEFINER helper functions away from `anon`.
--
-- These helpers were created with the default PUBLIC execute grant, leaving
-- them callable by unauthenticated users via /rest/v1/rpc/<fn>. They expose
-- relationship/privacy signals (follow graph, private-account flags), which a
-- privacy-first product should not hand to anonymous callers. They are only
-- ever needed by `authenticated` — directly in RLS policies evaluated as the
-- querying role, and by server functions running with the user's JWT. Nested
-- calls from other SECURITY DEFINER functions run as the owner, so revoking
-- anon/PUBLIC here does not affect them.
-- =====================================================================

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'can_view_profile(uuid, uuid)',
    'can_engage(uuid, uuid)',
    'dm_status(uuid, uuid)',
    'follows_user(uuid, uuid)',
    'is_mutual(uuid, uuid)',
    'get_privacy_flags(uuid[])',
    'is_account_private(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated;', fn);
  END LOOP;
END $$;
