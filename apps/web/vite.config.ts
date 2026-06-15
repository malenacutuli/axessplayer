/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite + React consumer web app. The base URLs for the live services are injected at runtime through
// VITE_ env vars (see src/config.ts), so one build points at mocks, staging, or production. No em dashes.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
