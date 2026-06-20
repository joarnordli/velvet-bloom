import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Better Auth server instance — the identity/session/2FA core that replaces
 * Supabase Auth (GoTrue). Server-only: imported by the `/api/auth/$` handler and
 * the `requireAuth` server middleware. Never import this from client code.
 *
 * Email is intentionally NOT wired yet (see docs/migration-to-self-hosted.md):
 * `requireEmailVerification: false`, no password-reset flow. 2FA is authenticator
 * (TOTP) only, via the twoFactor() plugin.
 *
 * The old Supabase `handle_new_user` trigger created a profiles row from signup
 * metadata. Better Auth has no DB trigger, so we mirror it with databaseHooks:
 * `before` validates/normalizes the chosen username (replacing the old
 * profiles_username_format CHECK + uniqueness at the app boundary), `after`
 * inserts the matching profiles row.
 */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — add it to the deployment environment.`);
  return v;
}

const USERNAME_RE = /^[a-z0-9_]+$/;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: required("BETTER_AUTH_SECRET"),
  baseURL: required("BETTER_AUTH_URL"),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 72,
  },
  user: {
    additionalFields: {
      // Captured at signup, persisted on the user row by Better Auth, then
      // mirrored into profiles by the create.after hook below.
      username: { type: "string", required: true, input: true },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (createdUser) => {
          const raw = (createdUser as { username?: string }).username ?? "";
          const username = raw.trim().toLowerCase();
          if (username.length < 3 || username.length > 24 || !USERNAME_RE.test(username)) {
            throw new APIError("BAD_REQUEST", {
              message: "Ugyldig brukernavn (3–24 tegn, kun a–z, 0–9 og _).",
            });
          }
          const existing = await db
            .select({ id: schema.profiles.id })
            .from(schema.profiles)
            .where(eq(schema.profiles.username, username))
            .limit(1);
          if (existing.length > 0) {
            throw new APIError("UNPROCESSABLE_ENTITY", {
              message: "Brukernavnet er allerede tatt.",
            });
          }
          return { data: { ...createdUser, username } };
        },
        after: async (createdUser) => {
          const username = (createdUser as { username?: string }).username;
          if (!username) return;
          await db
            .insert(schema.profiles)
            .values({ id: createdUser.id, username })
            .onConflictDoNothing();
        },
      },
    },
  },
  plugins: [
    twoFactor({ issuer: "mittpunkt" }),
    // Must be last: bridges Better Auth's Set-Cookie headers into TanStack Start's
    // server-function/SSR response so sessions persist after sign-in/sign-up.
    tanstackStartCookies(),
  ],
});
