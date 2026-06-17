// @axessplayer/ingestion: the automated content factory (C17). The on-upload DAG (idempotent, resumable,
// cost-gated), the accessibility stage definitions + cost tiering, and the sign quality tiers. The stage
// executors (transcribe / build-captions / build-ad / build-sign / generate-dubbing) and the 0009a+C2PA
// registrar are injected by the serving layer. No em dashes.
export * from "./stages.js";
export * from "./orchestrator.js";
export * from "./signTier.js";
export * from "./executors.js";
