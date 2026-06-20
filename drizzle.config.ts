import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `generate` (create SQL from schema.ts) needs no DB;
 * `migrate` / `push` connect using DATABASE_URL from .env.
 * Scripts: npm run db:generate | db:migrate | db:push | db:studio
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
