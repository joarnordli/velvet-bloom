import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Forward-only migration runner for production deploys (Coolify container start).
 *
 * Runs at RUNTIME (the Dockerfile CMD: `node migrate.mjs && node serve.mjs`),
 * never at build time — the build (`vite build`) never touches the DB. Uses
 * drizzle-orm's runtime migrator (NOT drizzle-kit, a devDependency absent from
 * the `--omit=dev` runner image). Applies every pending file in ./drizzle once,
 * idempotently, then exits; the container then starts serve.mjs. Never `db:push`
 * against production.
 *
 * Retries the initial connection because on a fresh Coolify deploy the app
 * container can boot a few seconds before the Postgres service is accepting
 * connections (ECONNREFUSED / getaddrinfo races). We wait it out instead of
 * crash-looping the whole app.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[migrate] DATABASE_URL is not set — cannot run migrations.");
  process.exit(1);
}

const MAX_ATTEMPTS = 15;
const RETRY_DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

try {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sql`select 1`;
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      console.log(
        `[migrate] DB not ready (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.code ?? err.message}. Retrying in ${RETRY_DELAY_MS / 1000}s…`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
  if (lastErr) throw lastErr;

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied.");
} catch (err) {
  console.error("[migrate] migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
