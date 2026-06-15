// The logged-decision dataset: one decision_log row joined with its attributed outcome signals. This is
// the unit both the trainer and the off-policy estimators consume. decision_log is READ-ONLY to this
// package (we never write it); the attributed-outcome join key is decision_id (decision_log.id), per
// W3_DECISION_DESIGN.md section 3 and 5. No em dashes.

import type { AttributedOutcome } from "./reward-weights.js";

// A single logged decision plus the context it was made in and the outcome attributed back to it.
//   - decisionId / variantId / propensity / policyVersion / isControl come from decision_log
//     (id, served_variant_id, propensity, policy_version, is_control).
//   - context x is the viewer feature vector at decision time, fixed-order (decision/features.ts order).
//   - armSet is the canon-filtered candidate arm ids the logging policy ranked at this decision; needed
//     so a candidate policy can recompute its own action distribution over the SAME arms.
//   - outcome is the attributed reward signals joined via decision_id.
export type LoggedDecision = {
  decisionId: string;
  userId: string;
  beatId: string;
  variantId: string; // served_variant_id, the arm the logging policy took
  propensity: number; // P(variantId | context) under the LOGGING policy. From decision_log.propensity.
  policyVersion: string;
  isControl: boolean;
  context: number[]; // viewer feature vector x, fixed order
  armSet: string[]; // canon-filtered candidate arm ids at this decision
  outcome: AttributedOutcome;
};

// Source of logged decisions. Real streaming ingestion is a clear interface; the fake reads an in-memory
// array. FLAGGED: a production source reads the decision_log stream joined with outcome events from the
// warehouse. The Postgres-backed source (pg-source.ts) reads decision_log from a REAL database but still
// derives the context/armSet/outcome from columns or a supplied joiner, because the walking-skeleton
// schema stores reward as JSONB and does not persist the per-decision feature vector.
export interface DecisionSource {
  load(): Promise<LoggedDecision[]>;
}

// In-memory fake. Use it to prove the trainer and estimator math on synthetic data with known ground
// truth. It does NOT read a real log. Flagged.
export class InMemorySource implements DecisionSource {
  constructor(private readonly rows: LoggedDecision[]) {}
  async load(): Promise<LoggedDecision[]> {
    return this.rows.map((r) => ({ ...r, context: [...r.context], armSet: [...r.armSet] }));
  }
}
