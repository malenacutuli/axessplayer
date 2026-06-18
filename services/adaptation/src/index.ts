// Public surface of the adaptation service (AI live-action adaptation, prompt 23, GOLD_STANDARD_15).
// Other workstreams consume the tier classifier, confidence scorer, rights gate, cost gate, the open
// AdaptationAdapter interface, and the DAG state machine through these exports. No em dashes.

export * from "./tiers.js";
export * from "./confidence.js";
export * from "./rightsGate.js";
export * from "./cost.js";
export * from "./adapters.js";
export * from "./analyze.js";
export * from "./dag.js";
export * from "./store.js";
export * from "./api.js";
export * from "./httpServer.js";
