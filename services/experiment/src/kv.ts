// Policy KV publish interface. The serving tier loads the hot policy (per-arm matrices, policy_version,
// alpha) from a KV cache, never Postgres (W3_DECISION_DESIGN.md section 4 and 5). The trainer publishes
// a new policy_version here and the serving tier picks it up without a deploy. No em dashes.
//
// FLAG: the real KV is Redis or an edge KV. The implementation here is an IN-MEMORY FAKE. It is a real,
// correct key/value interface (publish a versioned snapshot, read the current pointer, read a version),
// but it is process-local and not durable. Do not treat a publish here as a production rollout.

import type { ArmModel } from "./linucb.js";

// A published, immutable policy snapshot. policyVersion is the stable id the serving tier logs against.
export type PolicySnapshot = {
  policyVersion: string;
  alpha: number; // exploration coefficient baked into the version
  dim: number; // feature dimension the matrices are sized to
  arms: Record<string, ArmModel>; // per-arm trained matrices
  trainedAt: string; // ISO timestamp, deterministic when an explicit clock is supplied
  trainedFromDecisions: number; // how many logged decisions fed this policy, for provenance
};

export interface PolicyKV {
  publish(snapshot: PolicySnapshot): Promise<void>;
  current(): Promise<PolicySnapshot | null>; // the version the serving tier would load now
  get(policyVersion: string): Promise<PolicySnapshot | null>;
  versions(): Promise<string[]>;
}

// In-memory fake. FLAGGED. Last publish wins for current(); every version is retained for get().
export class InMemoryKV implements PolicyKV {
  private readonly store = new Map<string, PolicySnapshot>();
  private currentVersion: string | null = null;

  async publish(snapshot: PolicySnapshot): Promise<void> {
    this.store.set(snapshot.policyVersion, snapshot);
    this.currentVersion = snapshot.policyVersion;
  }
  async current(): Promise<PolicySnapshot | null> {
    return this.currentVersion ? (this.store.get(this.currentVersion) ?? null) : null;
  }
  async get(policyVersion: string): Promise<PolicySnapshot | null> {
    return this.store.get(policyVersion) ?? null;
  }
  async versions(): Promise<string[]> {
    return [...this.store.keys()];
  }
}
