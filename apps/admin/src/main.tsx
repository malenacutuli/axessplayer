// Browser entry point for the operator console. Imports the shared design-system fonts + tokens ONCE,
// sets data-skin="admin" on the document root (the ADMIN skin: dense console rhythm), then mounts the app
// inside the History router. The shared tokens/components carry the whole look; admin.css adds only the
// console chrome (topbar, rail, page scaffold) built on those tokens. No emojis, no em dashes.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@axessplayer/ui/fonts.css";
import "@axessplayer/ui/tokens.css";
import "./styles/admin.css";
import { App } from "./App.js";
import { RouterProvider } from "./router/router.js";

// ADMIN skin: set on the document element so the whole app (including portals) inherits the admin token
// overrides.
document.documentElement.setAttribute("data-skin", "admin");

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root element");
}
createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);
