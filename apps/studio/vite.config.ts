/// <reference types="vitest/config" />
// Vite config for the studio authoring UI. The contracts package has no `exports` map, so the generated
// content types are resolved by a path alias that mirrors the content service's tsconfig path. This binds
// the studio's READ types (the series graph operation, its path param) to the codegen, so a contract drift
// on the graph path breaks the studio typecheck. No em dashes.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@axessplayer/contracts/content": fileURLToPath(
        new URL("../../contracts/types/generated/content.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
});
