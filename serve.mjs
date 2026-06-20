import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import handler from "./dist/server/server.js";

/**
 * Production Node server for the Coolify container.
 *
 * TanStack Start (this version) builds to a web `fetch` handler
 * (dist/server/server.js, our src/server.ts SSR wrapper) + static client assets
 * (dist/client) — but no HTTP server. This wraps both: static files first, then
 * SSR / server-function handling. Vendor-neutral; run with `node serve.mjs`.
 */
const app = new Hono();

// Hashed, immutable client assets. Falls through to SSR on a miss.
app.use("/*", serveStatic({ root: "./dist/client" }));

// Everything else → TanStack Start SSR + server functions.
app.all("/*", (c) => handler.fetch(c.req.raw));

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`mittpunkt listening on http://0.0.0.0:${info.port}`);
});
