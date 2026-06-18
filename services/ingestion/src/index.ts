// @axessplayer/ingestion: the automated content factory (C17). The on-upload DAG (idempotent, resumable,
// cost-gated), the accessibility stage definitions + cost tiering, and the sign quality tiers. The stage
// executors (transcribe / build-captions / build-ad / build-sign / generate-dubbing) and the 0009a+C2PA
// registrar are injected by the serving layer. No em dashes.
export * from "./stages.js";
export * from "./orchestrator.js";
export * from "./signTier.js";
export * from "./executors.js";
export * from "./costModel.js";
export * from "./trustRegistrar.js";
// The JOB API CONTRACT layer (POST /produce, GET /jobs, GET /jobs/:id): the fan-out plan + cost preview,
// the produce-job store + stage state machine (unwired until mobile.produce_jobs is applied), the pure HTTP
// handlers, and the node:http server bridge.
export * from "./produceCost.js";
export * from "./jobsStore.js";
export * from "./jobApi.js";
export * from "./httpServer.js";
// The REAL produce executor (the accessibility factory over the existing Supabase edge functions) + its
// runtime adapters + the store runner bridge.
export * from "./produceExecutor.js";
export * from "./produceRuntime.js";
export * from "./produceRunner.js";
