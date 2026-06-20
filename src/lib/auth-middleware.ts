import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./auth";

/**
 * Server-function middleware that gates a serverFn on a valid Better Auth session
 * and injects the authenticated `userId` into `context`.
 *
 * Drop-in replacement for the old `requireSupabaseAuth` (which injected
 * `{ supabase, userId, claims }`). There is no `supabase` client anymore — server
 * functions query the DB via Drizzle (`import { db } from "@/db"`). Auth rides on
 * the same-origin session cookie, so no client-side bearer-attach middleware is
 * needed (the old `attachSupabaseAuth` is removed).
 */
export const requireAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      throw new Error("Unauthorized: No active session");
    }

    return next({
      context: {
        userId: session.user.id,
        user: session.user,
      },
    });
  },
);
