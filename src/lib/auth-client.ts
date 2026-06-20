import { createAuthClient } from "better-auth/react";
import { twoFactorClient, inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

/**
 * Browser-side Better Auth client. Same-origin: it talks to the `/api/auth/*`
 * handler mounted in `src/server.ts`, so no base URL / public env var is needed.
 *
 * Replaces the Supabase browser client (`@/integrations/supabase/client`) for all
 * auth flows (sign-in/up, session, sign-out, 2FA). `inferAdditionalFields<typeof
 * auth>()` types the extra `username` signup field.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession, twoFactor } = authClient;
