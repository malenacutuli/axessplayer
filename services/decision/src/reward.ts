// Reward shaping. The reward is a weighted blend of delayed signals (design 3). The weights are a
// PRODUCT decision held in config (PLACEHOLDER 1) and are NOT finalized or optimized against here in
// scaffold mode. This module only provides the shape: normalize each signal to [0,1], then weight.
// The offline trainer (stubbed) is the only consumer; the serving path does not compute reward. No em
// dashes.

import { REWARD_WEIGHTS } from "./config.js";

// The attributed outcome for a decision, joined back via decision_id minutes to days later (design 3).
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
// does not silently win (design 3).
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

// reward = w_c*completion + w_r*returned + w_m*monetization - w_p*penalty
// PLACEHOLDER WEIGHTS (config.REWARD_WEIGHTS): awaits human ratification, do not ship unratified.
export function shapeReward(o: AttributedOutcome): number {
  const s = normalizeSignals(o);
  const { w_c, w_r, w_m, w_p } = REWARD_WEIGHTS;
  return w_c * s.completion + w_r * s.returned + w_m * s.monetization - w_p * s.penalty;
}
