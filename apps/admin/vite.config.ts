/// <reference types="vitest" />
// Vite + React operator console (apps/admin). The ADMIN API base url is injected at runtime through the
// VITE_ADMIN_API_BASE_URL env var (see src/api/adminApi.ts), so one build can point at mocks, staging, or
// production. The browser talks SAME-ORIGIN to Vite in dev, which forwards the /admin route prefix to the
// locally running content service that hosts the admin endpoints (mirrors apps/web). No em dashes.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Default ADMIN API base is the same-origin "/admin" prefix; forward it to the local content service
      // (the walking-skeleton stack hosts the admin endpoints there, see apps/web/vite.config.ts).
      "/admin": "http://127.0.0.1:8093",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
