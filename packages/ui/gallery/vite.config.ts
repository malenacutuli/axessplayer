// Vite config for the component gallery. Run from packages/ui:
//   vite build --config gallery/vite.config.ts   -> packages/ui/gallery/dist (Vercel preview)
//   vite        --config gallery/vite.config.ts   -> dev server
// root points at the gallery dir so index.html + main.tsx resolve there. No em dashes.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const galleryDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: galleryDir,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
