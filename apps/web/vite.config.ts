/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite + React consumer web app. The base URLs for the live services are injected at runtime through
// VITE_ env vars (see src/config.ts), so one build points at mocks, staging, or production. No em dashes.
export default defineConfig({
  plugins: [react()],
  // Dev proxy: the browser talks same-origin to Vite, which forwards each service's route prefix to the
  // locally running service (avoids CORS without touching service code). Route prefixes are disjoint, so
  // set VITE_*_BASE_URL to "" (same origin) and the paths route by prefix. Ports match the local stack.
  server: {
    proxy: {
      "/feed": "http://127.0.0.1:8093",
      "/series": "http://127.0.0.1:8093",
      "/wallet": "http://127.0.0.1:8091",
      "/spend": "http://127.0.0.1:8091",
      "/grant": "http://127.0.0.1:8091",
      "/decide": "http://127.0.0.1:8092",
      "/manifest": "http://127.0.0.1:8094",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
