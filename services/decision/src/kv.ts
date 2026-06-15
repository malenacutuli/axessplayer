// The KV serving layer. The hot decision path reads the viewer vector, the candidate arm models, and
// the live policy params from KV (Redis or edge KV), NEVER from Postgres (design 4). Postgres is the
// system of record, refreshed into KV by change-data-capture. This module is the serving-side
// interface plus an in-memory FAKE used by tests and local runs. No em dashes.
//
// FLAG: the real KV (Redis/edge KV) and its CDC refresh are NOT built in this cut. The interface below
// is real and the serving path uses it; the implementation here is an in-memory fake. Any latency
// measured against this fake is an in-memory micro-benchmark, NOT a production KV measurement, and is
// reported as such.

import { type PreferenceVector } from "./features.js";
import { type ArmModel, newArmModel } from "./bandit.js";

export interface PolicyKV {
  // Hot copy of the viewer preference vector. Null if not yet warmed (caller cold-starts from cohort).
  getViewerVector(userId: string, seriesId: string): Promise<PreferenceVector | null>;
  putViewerVector(userId: string, seriesId: string, v: PreferenceVector): Promise<void>;
  // Hot per-arm bandit model for the live policy_version. Falls back to the identity prior if absent.
  getArmModel(variantId: string, policyVersion: string): Promise<ArmModel | null>;
  putArmModel(variantId: string, policyVersion: string, model: ArmModel): Promise<void>;
}

// In-memory PolicyKV. FAKE for this cut. Maps mirror what Redis/edge KV would hold.
export class InMemoryKV implements PolicyKV {
  private vectors = new Map<string, PreferenceVector>();
  private models = new Map<string, ArmModel>();

  private vkey(userId: string, seriesId: string) {
    return `${userId}:${seriesId}`;
  }
  private mkey(variantId: string, policyVersion: string) {
    return `${policyVersion}:${variantId}`;
  }

  async getViewerVector(userId: string, seriesId: string): Promise<PreferenceVector | null> {
    return this.vectors.get(this.vkey(userId, seriesId)) ?? null;
  }
  async putViewerVector(userId: string, seriesId: string, v: PreferenceVector): Promise<void> {
    this.vectors.set(this.vkey(userId, seriesId), v);
  }
  async getArmModel(variantId: string, policyVersion: string): Promise<ArmModel | null> {
    return this.models.get(this.mkey(variantId, policyVersion)) ?? null;
  }
  async putArmModel(variantId: string, policyVersion: string, model: ArmModel): Promise<void> {
    this.models.set(this.mkey(variantId, policyVersion), model);
  }
}

// Resolve an arm's model from KV, falling back to the identity prior (cold arm). Deterministic.
export async function armModelOrPrior(
  kv: PolicyKV,
  variantId: string,
  policyVersion: string
): Promise<ArmModel> {
  return (await kv.getArmModel(variantId, policyVersion)) ?? newArmModel();
}
