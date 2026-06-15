// Offline training loop. Consumes logged decisions (decision_log joined with attributed outcomes),
// shapes each outcome into a scalar reward with the RATIFIED weights, folds it into the per-arm LinUCB
// model, stamps a new policy_version, and publishes the snapshot to the KV the serving tier reads.
// Deterministic given the input ordering and a fixed clock, so a seed reproduces the parameters exactly.
// Per W3_DECISION_DESIGN.md section 5. No em dashes.
//
// FLAG: the streaming ingestion (DecisionSource) and the KV publish (PolicyKV) are real interfaces with
// in-memory fakes for this cut. The reward shaping and the LinUCB arithmetic are real and final. A
// policy trained here is byte-compatible with the serving bandit, but it has only been published to a
// process-local fake KV, not a durable production store.

import { foldSample, newArmModel, type ArmModel } from "./linucb.js";
import { shapeReward } from "./reward-weights.js";
import type { DecisionSource, LoggedDecision } from "./dataset.js";
import type { PolicyKV, PolicySnapshot } from "./kv.js";

export type TrainConfig = {
  dim: number; // feature dimension (decision/features.ts FEATURE_DIM = 9)
  alpha: number; // exploration coefficient baked into the stamped version (config.EXPLORATION_ALPHA)
  basePolicyVersion: string; // e.g. "linucb-0.1.0"; the trainer appends a content hash
  lambda?: number; // ridge prior, default 1 to match the serving identity prior
  now?: () => Date; // injectable clock for deterministic trainedAt in tests
};

// A deterministic, dependency-free content stamp over the trained parameters, so two runs over the same
// data yield the same policy_version and a different dataset yields a different one. Not cryptographic;
// it only needs to be stable and collision-resistant enough to tag a policy build. FNV-1a 32-bit.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stampVersion(base: string, alpha: number, arms: Record<string, ArmModel>): string {
  const keys = Object.keys(arms).sort();
  // Round b to stabilize the hash against floating point noise across equivalent runs.
  const payload = keys
    .map((k) => `${k}:${arms[k].b.map((v) => v.toFixed(6)).join(",")}`)
    .join("|");
  return `${base}+alpha=${alpha}+h=${fnv1a(payload)}`;
}

export type TrainResult = {
  snapshot: PolicySnapshot;
  arms: Record<string, ArmModel>;
  rewardsByArm: Record<string, number[]>; // shaped rewards folded per arm, for inspection and tests
};

// Train per-arm LinUCB models from the logged dataset. Control decisions (is_control) are excluded: a
// control decision was served the director's cut by the holdout, not by the policy, so it carries no
// propensity and must not update arm parameters. Pure given (rows, cfg.now).
export function trainModels(rows: LoggedDecision[], cfg: TrainConfig): TrainResult {
  const lambda = cfg.lambda ?? 1;
  const arms: Record<string, ArmModel> = {};
  const rewardsByArm: Record<string, number[]> = {};
  let used = 0;
  for (const r of rows) {
    if (r.isControl) continue;
    const reward = shapeReward(r.outcome);
    const model = (arms[r.variantId] ??= newArmModel(cfg.dim, lambda));
    foldSample(model, r.context, reward);
    (rewardsByArm[r.variantId] ??= []).push(reward);
    used++;
  }
  const now = (cfg.now ?? (() => new Date()))();
  const snapshot: PolicySnapshot = {
    policyVersion: stampVersion(cfg.basePolicyVersion, cfg.alpha, arms),
    alpha: cfg.alpha,
    dim: cfg.dim,
    arms,
    trainedAt: now.toISOString(),
    trainedFromDecisions: used,
  };
  return { snapshot, arms, rewardsByArm };
}

// The full loop: ingest from the source, train, publish to KV. Returns the published snapshot.
export async function runTrainingLoop(
  source: DecisionSource,
  kv: PolicyKV,
  cfg: TrainConfig
): Promise<TrainResult> {
  const rows = await source.load();
  const result = trainModels(rows, cfg);
  await kv.publish(result.snapshot);
  return result;
}
