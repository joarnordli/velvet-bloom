import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

/**
 * Standard Vite + TanStack Start config (de-Lovable'd).
 *
 * Replaces `@lovable.dev/vite-tanstack-config`, which bundled these same plugins
 * but overrode Nitro's preset to cloudflare/vercel. With a plain build, Nitro
 * defaults to `node-server` (`.output/server/index.mjs`) — what the Coolify
 * container runs. The SSR error wrapper at `src/server.ts` is picked up by
 * TanStack Start's convention.
 */
export default defineConfig({
  server: {
    port: 8080,
    host: true,
  },
  resolve: {
    // Avoid duplicate React / Query copies in the bundle.
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
