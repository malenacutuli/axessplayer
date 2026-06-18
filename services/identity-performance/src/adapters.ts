// Performance adapters for the identity-performance service: LIP-SYNC (per-language dub alignment) and
// DE-AGING / performance-preservation. Both are best-effort, COST-GATED, and STUBBED until a vendor is wired.
//
// HARD RULE (never fabricate): an UNWIRED adapter NEVER returns a synced/aged asset. It returns a
// status:"unwired" result with assetUrl:null. Only a real wired adapter ever sets assetUrl. The drift scorer
// and the store treat a null asset/embedding as "nothing produced", so an unwired adapter can never make a
// title look published or move the drift guard.
//
// COST GATE: every adapter call carries an estimated cost; a call whose estimate exceeds the configured
// ceiling is REFUSED with status:"cost_gated" before any vendor work. This keeps a runaway batch from
// spending. No em dashes.

export type AdapterKind = "lipsync" | "deage";

export type AdapterStatus = "unwired" | "cost_gated" | "produced";

export interface AdapterResult {
  kind: AdapterKind;
  status: AdapterStatus;
  // Only ever non-null when status === "produced" by a real wired vendor. Null otherwise (never fabricated).
  assetUrl: string | null;
  // Embedding sampled from the produced asset, for the drift scorer. Null unless produced.
  embedding: number[] | null;
  // Human-readable reason, for the response + audit trail.
  reason: string;
  // The estimated cost the gate evaluated, echoed for transparency.
  estimatedCost: number;
}

export interface LipsyncRequest {
  identityId: string;
  // Target language for the dub alignment, e.g. "es-419".
  language: string;
  estimatedCost: number;
}

export interface DeageRequest {
  identityId: string;
  // Target apparent age delta in years (negative de-ages, positive ages). Carried through to the vendor.
  targetAgeDelta: number;
  estimatedCost: number;
}

// The vendor port. A wired implementation talks to the lip-sync / de-aging provider. There is intentionally
// NO default implementation: until a vendor is injected, the adapter is unwired and produces nothing.
export interface PerformanceVendor {
  lipsync(req: LipsyncRequest): Promise<{ assetUrl: string; embedding: number[] }>;
  deage(req: DeageRequest): Promise<{ assetUrl: string; embedding: number[] }>;
}

export interface AdapterConfig {
  // Cost ceiling. A request whose estimatedCost exceeds this is refused (cost_gated) before any vendor call.
  costCeiling: number;
  // Injected vendor, or null when unwired (the default). Null => every call returns status:"unwired".
  vendor: PerformanceVendor | null;
}

export function defaultAdapterConfig(): AdapterConfig {
  // No vendor wired by default: the adapter is honest about being unwired and fabricates nothing.
  return { costCeiling: 5.0, vendor: null };
}

async function runAdapter(
  cfg: AdapterConfig,
  kind: AdapterKind,
  estimatedCost: number,
  call: (vendor: PerformanceVendor) => Promise<{ assetUrl: string; embedding: number[] }>
): Promise<AdapterResult> {
  // COST GATE first: refuse before any vendor work.
  if (estimatedCost > cfg.costCeiling) {
    return {
      kind,
      status: "cost_gated",
      assetUrl: null,
      embedding: null,
      reason: `estimated cost ${estimatedCost} exceeds ceiling ${cfg.costCeiling}`,
      estimatedCost,
    };
  }
  // UNWIRED: no vendor injected. Never fabricate an asset.
  if (cfg.vendor == null) {
    return {
      kind,
      status: "unwired",
      assetUrl: null,
      embedding: null,
      reason: "no performance vendor wired; refusing to fabricate an asset",
      estimatedCost,
    };
  }
  const out = await call(cfg.vendor);
  return {
    kind,
    status: "produced",
    assetUrl: out.assetUrl,
    embedding: out.embedding,
    reason: "produced by wired vendor",
    estimatedCost,
  };
}

export function runLipsync(cfg: AdapterConfig, req: LipsyncRequest): Promise<AdapterResult> {
  return runAdapter(cfg, "lipsync", req.estimatedCost, (v) => v.lipsync(req));
}

export function runDeage(cfg: AdapterConfig, req: DeageRequest): Promise<AdapterResult> {
  return runAdapter(cfg, "deage", req.estimatedCost, (v) => v.deage(req));
}
