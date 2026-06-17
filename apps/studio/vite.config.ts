/// <reference types="vitest/config" />
// Vite config for the studio authoring UI. The contracts package has no `exports` map, so the generated
// content types are resolved by a path alias that mirrors the content service's tsconfig path. This binds
// the studio's READ types (the series graph operation, its path param) to the codegen, so a contract drift
// on the graph path breaks the studio typecheck. No em dashes.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Dev proxy: mirror apps/web/vite.config.ts so the browser talks SAME-ORIGIN to Vite, which forwards the
// content service's route prefixes to the locally running content service (avoids CORS without touching
// service code). Default the content base URL to same-origin ("") in dev and these proxies route by prefix.
// Only the content service prefixes are owned by the studio. Port matches apps/web (the local stack).
const CONTENT_TARGET = "http://127.0.0.1:8093";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@axessplayer/contracts/content": fileURLToPath(
        new URL("../../contracts/types/generated/content.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      "/series": CONTENT_TARGET,
      "/episodes": CONTENT_TARGET,
      "/beats": CONTENT_TARGET,
      "/variants": CONTENT_TARGET,
      "/edges": CONTENT_TARGET,
      "/admin": CONTENT_TARGET,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
});
