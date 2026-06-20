// Public surface of the W8 generation pipeline. Other workstreams consume W8 through these exports and the
// frozen schema rows it writes. W9 in particular consumes the C2PA manifest types and the
// SignedManifestHandoff shape. No em dashes.

export * from "./spec.js";
export * from "./backends.js";
export * from "./c2pa.js";
export * from "./qa.js";
export * from "./generationDb.js";
export * from "./cdn.js";
export * from "./pipeline.js";
export * from "./finops.js";
export * from "./variantSource.js";
// Prompt 26 / GOLD_STANDARD_16: the model-agnostic router + consistency QA + auto-retry + consent gate.
export * from "./router.js";
export * from "./consistency.js";
export * from "./consentGate.js";
