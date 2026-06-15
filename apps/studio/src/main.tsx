// Browser entry. Import the official brand tokens ONCE here, before any other CSS, then the studio
// styles that build on those tokens. No em dashes.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/brand-tokens.css";
import "./styles/studio.css";
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
