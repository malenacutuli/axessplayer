// Browser entry. Import the official brand tokens ONCE here, before any other CSS, then the studio
// styles that build on those tokens. No em dashes.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Shared design-system fonts + tokens (the --axp-* set + the studio skin), imported ALONGSIDE the existing
// brand tokens so both --bg/--ink and --axp-* are available (mirrors apps/web). Order: design-system fonts
// /tokens first, then the brand tokens, then the studio styles, then the new shell styles that consume them.
import "@axessplayer/ui/fonts.css";
import "@axessplayer/ui/tokens.css";
import "./styles/brand-tokens.css";
import "./styles/studio.css";
import "./styles/creator-studio.css";
import "./styles/studio-sections.css";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root element");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
