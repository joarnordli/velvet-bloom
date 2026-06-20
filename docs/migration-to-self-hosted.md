# Migration: Supabase/Lovable → self-hosted Postgres + Drizzle + Better Auth

## TL;DR recommendation
The app is **pre-launch with only test/seed data** (8 `@dev.local` users, ~16 seed posts, one test account). **DECIDED 2026-06-14: start fresh — no data migration, no auth-user/password migration.** Stand up the new stack clean and re-seed dev data with a script. The "full data migration" (Appendix B) is shelved unless real data accrues first.

Because we're NOT preserving existing UUIDs, use **Better Auth's default `text` ids** for `user.id` (simplest — no custom id config). App entity PKs stay `uuid` (`gen_random_uuid`); columns that reference a user become `text` FKs to `user.id`.

The "full data migration" (Appendix B) is only worth doing once you have **real users/content to preserve**. Everything in "Required either way" (below) must happen regardless of whether data moves.

---

## Required either way (the actual migration work)

### 1. Model the app schema in Drizzle (`src/db/schema.ts`)
Better Auth's 4 tables are done. Add the ~15 app tables (currently defined across `supabase/migrations/*.sql`):
`profiles`, `posts`, `post_likes`, `post_comments`, `follows`, `conversations`, `conversation_participants`, `messages`, `message_attachments`, `user_privacy_settings`, `user_blocks`, `push_subscriptions`, `notification_prefs`, `notifications`, `follow_requests`, + the `dm_audience` enum.
- Keep **UUID** primary/foreign keys for app tables (preserves existing relationships and lets data copy 1:1 if ever needed).
- `profiles.id` becomes a 1:1 FK to Better Auth `user.id`. Better Auth `user.id` is `text` — store the existing UUID **as text** so every `author_id`/`user_id` FK still lines up. Keep app FKs as `uuid` and reference `user.id` via the same value (text↔uuid cast handled at the boundary), or make app user-referencing columns `text` too. **Decision:** simplest is to make all user-referencing app columns `text` to match Better Auth, OR keep `user.id` as `uuid`. Recommend: set Better Auth `user.id` to `uuid` (Better Auth supports custom id generation) so the whole graph stays `uuid` — cleaner.
- Then `npm run db:generate` → review SQL → `npm run db:migrate`.

### 2. Wire Better Auth
- `src/lib/auth.ts`: `betterAuth({ database: drizzleAdapter(db, { provider: "pg", schema }), emailAndPassword: { enabled: true }, plugins: [twoFactor()], secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL })`. (`twoFactor` replaces the old TOTP — adds a `twoFactor` table; re-run `npx @better-auth/cli generate`.)
- Mount the handler: a TanStack Start API route (`/api/auth/$`) → `auth.handler(request)`.
- `src/lib/auth-client.ts`: `createAuthClient()` for the browser.
- Replace `auth-middleware.ts` (`requireSupabaseAuth`) with a Better Auth session check: `const session = await auth.api.getSession({ headers })`; gate server fns on `session.user.id`.
- Rewrite `auth.tsx` (login/signup) to call the Better Auth client instead of `supabase.auth`.

### 3. Authorization (RLS → app-level)
Self-hosted Postgres has RLS, but it relied on Supabase's `auth.uid()` (JWT claim) — which won't exist. **Move authz into the query layer:**
- Port the SECURITY DEFINER helpers (`can_view_profile`, `can_engage`, `dm_status`, `can_dm`, `is_mutual`, `follows_user`, `get_profile_card`, `is_conversation_member`, `get_or_create_dm`) to the new DB as **plain SQL functions taking explicit uuid args** (they already do, except where they call `auth.uid()` — pass the caller's id explicitly).
- Every Drizzle query filters by the authenticated `session.user.id`. The privacy gates (private accounts, DM audiences, blocks, engagement rules) become explicit `WHERE`/function calls in the `*.functions.ts` rewrites — same logic, enforced in app code.
- Drop all `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` — there's no Supabase role/JWT context to back them.

### 4. Rewrite the data layer (`src/lib/*.functions.ts`)
Every `posts/profiles/messages/follows/likes/comments/reposts/notifications/privacy/places.functions.ts` uses `context.supabase` (PostgREST). Rewrite each to Drizzle queries against `db`, using the Better Auth session for the user id. This is the bulk of the work. The `mapPostRows` hydration logic ports directly (and is a good moment to **denormalize engagement counts** — the Phase 3 scale fix).

### 5. Storage (Supabase Storage → self-hosted)
Buckets `avatars`, `post-media`, `message-media` (private, signed URLs, EXIF-stripped client-side). Replace with **S3-compatible (MinIO on the VPS, or Cloudflare R2/Backblaze B2)**:
- New upload helpers (presigned PUT) + signed-GET URL generation to swap for `supabase.storage.createSignedUrl(s)`.
- EXIF stripping stays client-side (`strip-exif.ts` unchanged).
- Per-object access control moves to app code (the storage RLS policies are gone).
- **Decision needed:** which object store.

### 6. Realtime (Supabase Realtime → replacement)
Used by: messages thread, inbox, notifications, profile changes (`postgres_changes` + presence + broadcast for typing). Replace with one of:
- **Postgres `LISTEN/NOTIFY` + a small WebSocket server** (most faithful; triggers `NOTIFY` on insert, WS fans out). 
- A managed/self-hosted broker (**Soketi**, Centrifugo).
- **Short-poll** via TanStack Query `refetchInterval` (simplest, ship-first, no infra).
- **Decision needed:** which approach. Recommend starting with polling to unblock, then LISTEN/NOTIFY+WS for the chat.

### 7. Cutover & cleanup
- Flip env to the VPS (`DATABASE_URL`, storage creds, `BETTER_AUTH_*`); remove `VITE_SUPABASE_*` / `@supabase/supabase-js`.
- Resolve the **package-manager split** (npm `package-lock.json` vs `bun.lock`) — pick one, update Vercel accordingly — **before** deploying code that imports Drizzle/Better Auth.
- Verify end-to-end, then decommission the Supabase project.

---

## Suggested sequencing
1. App schema in Drizzle + migrate to VPS (clean). 2. Better Auth wired + auth.tsx + middleware. 3. Authz helpers ported. 4. Rewrite `*.functions.ts` feature-by-feature (start: profiles+posts+feed, then follows, then messages). 5. Storage adapter. 6. Realtime (polling → WS). 7. Cutover. Ship behind the existing Supabase app until each slice is proven.

---

## Decisions to make
- **Object store** for media (MinIO on VPS / R2 / B2).
- **Realtime** approach (polling first vs. LISTEN/NOTIFY+WS).
- **Package manager** (npm vs bun) + Vercel install command.
- `user.id` type (recommend `uuid` to keep the graph uniform).
- Data: **start fresh (recommended)** vs. preserve (Appendix B).

---

## Appendix A — start-fresh path (recommended now)
1. Finish app schema in Drizzle, migrate to VPS. 2. Wire Better Auth. 3. Rewrite functions + storage + realtime. 4. Re-create dev seed via a script (port `mittpunkt-seed-data`). No data copy, no auth-user migration. Real users register on the new stack.

## Appendix B — full data migration (only if preserving real data)
1. **App data:** apply the app schema to the VPS, then `pg_dump --data-only --schema=public` from Supabase (or a typed copy script over both connections); insert in FK order (users→profiles→posts→likes/comments→…). Strip Supabase-only objects (RLS policies, `auth.*` refs, storage/realtime publication).
2. **Auth users (hard):** map `auth.users` → Better Auth `user` (+ a `credential` `account` row per user). Keep the same id. `emailVerified` from `email_confirmed_at`. **Passwords:** Supabase bcrypt ≠ Better Auth scrypt — either (a) configure Better Auth `emailAndPassword.password.verify` to check legacy bcrypt on first login (no reset needed), or (b) force password-reset emails for everyone. Recommend (a).
3. **Storage files:** copy every object from the 3 Supabase buckets to the new store, preserving paths so `*_path` columns stay valid.
4. Maintenance window; verify counts + a sample login per migration batch.
