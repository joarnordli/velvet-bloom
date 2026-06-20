# syntax=docker/dockerfile:1
# Production image for Coolify (self-hosted VPS). Builds the TanStack Start app
# and runs the Hono Node server (serve.mjs). Auth (Better Auth), data (Drizzle),
# and media (Cloudflare R2) are all server-side — no public build args are needed
# (the Better Auth client is same-origin; R2 creds never reach the browser).

# ---------- Build ----------
FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Run ----------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Runtime deps only (SSR externalizes node_modules, so they're needed at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built output + the production server entry + the migration runner & files.
COPY --from=builder /app/dist ./dist
COPY serve.mjs migrate.mjs ./
COPY drizzle ./drizzle

EXPOSE 3000
# Apply pending migrations, then start the server. Migrations are forward-only
# and idempotent (drizzle tracks applied files), so this is safe on every boot.
CMD ["sh", "-c", "node migrate.mjs && node serve.mjs"]
