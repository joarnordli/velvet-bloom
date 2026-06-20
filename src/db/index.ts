import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client for the self-hosted Postgres (Coolify VPS).
 * Import as: `import { db } from "@/db";`
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set — add it to .env (the self-hosted Postgres connection string).",
  );
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
