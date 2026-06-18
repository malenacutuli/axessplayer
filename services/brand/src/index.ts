// @axessplayer/brand: the brand revenue rail (prompt 19). Brand/agency accounts + campaigns, generation-
// time placement against GROUND-TRUTH scene metadata (no CV, no tracking), brand-safety + canon-safety HARD
// filters, a licensed demand-rail ADAPTER interface (Magnite/GAM/SSAI stubs, license-not-build), the
// SEPARATE brand-performance flywheel behind the content/ad firewall, and TEST-mode double-entry billing
// that reconciles to ledger entries. node:http server on PORT 8104. No em dashes.
export * from "./types.js";
export * from "./safety.js";
export * from "./demand.js";
export * from "./placement.js";
export * from "./flywheel.js";
export * from "./billing.js";
export * from "./store.js";
export * from "./auth.js";
export { createBrandServer, type BrandServerDeps } from "./server.js";
