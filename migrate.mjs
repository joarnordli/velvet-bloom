import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Forward-only migration runner for production deploys (Coolify container start).
 *
 * Uses drizzle-orm's runtime migrator (NOT drizzle-kit, which is a devDependency
 * and absent from the `--omit=dev` runner image). Applies every pending file in
 * ./drizzle once, idempotently, then exits — the container then starts serve.mjs.
 * Never use `db:push` against production.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[migrate] DATABASE_URL is not set — cannot run migrations.");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied.");
} catch (err) {
  console.error("[migrate] migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
