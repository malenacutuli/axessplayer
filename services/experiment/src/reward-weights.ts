// Reward shaping constants, MIRRORED from the RATIFIED source of record.
//
// SOURCE OF RECORD: services/decision/src/config.ts (REWARD_WEIGHTS, RETURN_WINDOW_DAYS), ratified
// 2026-06-15. The W3_DECISION_DESIGN.md section 3 reward blend is RATIFIED, so the offline trainer here
// MAY finalize and optimize against it. We MIRROR these constants rather than import them so this
// package stays free of a cross-package build dependency on the decision engine's dist layout (its
// tsconfig rootDir spans the repo, which makes a clean workspace import fragile). These are NOT new
// business values: they are a verbatim copy of the ratified config, and the experiment trainer must
// never redefine its own weights. If config.ts changes, this file changes with it. No em dashes.
//
// reward = w_c*completion + w_r*returned + w_m*monetization - w_p*penalty   (each signal normalized [0,1])

export const REWARD_WEIGHTS = {
  w_c: 1.0, // completion
  w_r: 0.5, // returned within window
  w_m: 0.3, // monetization event
  w_p: 2.0, // canon or quality penalty (subtracted)
} as const;

// Attribution window for the delayed "returned" signal. Mirrored from config.RETURN_WINDOW_DAYS.
export const RETURN_WINDOW_DAYS = 7;

// The attributed outcome for a decision, joined back via decision_id minutes to days later (design 3).
// Mirrors services/decision/src/reward.ts AttributedOutcome.
export type AttributedOutcome = {
  completion: number; // 0..1, near-term
  returned_within_window: boolean; // arrives within RETURN_WINDOW_DAYS
  monetization_event: boolean; // a coin spend attributed to this decision
  canon_or_quality_penalty: number; // 0..1, a quality/canon defect score
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Normalize each signal to a comparable [0,1] scale before weighting, so the largest-magnitude signal
// does not silently win (design 3). Mirrors decision/reward.ts normalizeSignals.
export function normalizeSignals(o: AttributedOutcome): {
  completion: number;
  returned: number;
  monetization: number;
  penalty: number;
} {
  return {
    completion: clamp01(o.completion),
    returned: o.returned_within_window ? 1 : 0,
    monetization: o.monetization_event ? 1 : 0,
    penalty: clamp01(o.canon_or_quality_penalty),
  };
}

// reward = w_c*completion + w_r*returned + w_m*monetization - w_p*penalty. RATIFIED weights.
export function shapeReward(o: AttributedOutcome): number {
  const s = normalizeSignals(o);
  const { w_c, w_r, w_m, w_p } = REWARD_WEIGHTS;
  return w_c * s.completion + w_r * s.returned + w_m * s.monetization - w_p * s.penalty;
}

// Theoretical reward bounds given the ratified weights, used to clamp the doubly-robust outcome model
// so an estimator cannot return a value outside what the shaping can produce.
export const REWARD_MIN = -REWARD_WEIGHTS.w_p; // all penalty, nothing else: -2.0
export const REWARD_MAX = REWARD_WEIGHTS.w_c + REWARD_WEIGHTS.w_r + REWARD_WEIGHTS.w_m; // 1.8
