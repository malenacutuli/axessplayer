// Registers a module-resolution hook (via --import) that maps any .css import to an empty module, so the
// gallery React tree can be imported under tsx/Node for the axe audit. jsdom has no layout, so CSS is
// irrelevant to the structural a11y checks run here; color-contrast is verified against the deployed
// gallery instead. No em dashes.
import { register } from "node:module";

// import.meta.url is already a file:// URL; use it directly as the parent (do not re-wrap it).
register("./css-hooks.mjs", import.meta.url);
