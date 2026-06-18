// Browser entry for the component gallery. Imports the design system styles once, then mounts the
// shared Gallery tree (also consumed by axe-audit.ts). Color-contrast is verified against this
// rendered page in Vercel preview, since jsdom has no layout/paint. No em dashes.
import * as React from "react";
import { createRoot } from "react-dom/client";
import "@axessplayer/ui/tokens.css";
import "@axessplayer/ui/fonts.css";
import { Gallery } from "./gallery";

const el = document.getElementById("root");
if (!el) {
  throw new Error("gallery: #root not found");
}
createRoot(el).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
