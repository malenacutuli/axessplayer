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
