// Decision engine configuration. Single source of truth for the tunables.
// Reward shaping and the control holdout are RATIFIED (2026-06-15). ONE placeholder remains: the EU AI
// Act explainability bar, which awaits legal/counsel ratification. Tunables are isolated here so each
// ratification is a one-line change, not a code hunt. No em dashes.

// =====================================================================================================
// REWARD WEIGHTS  (PRODUCT / BUSINESS CALL) -- RATIFIED 2026-06-15, revisit with data later.
// Ratified by the business owner as the completion-first starting point (w_c dominant, w_m deliberately
// small so the engine does not learn to paywall-bait). Each signal is normalized to [0,1] before
// weighting (see normalizeSignals) so the largest-magnitude signal does not silently win. Reward shaping
// MAY now be finalized and optimized against these by the offline trainer; revisit the weights once real
// logged outcome data exists. Per W3_DECISION_DESIGN.md section 3 and open decision 10.1.
// =====================================================================================================
export const REWARD_WEIGHTS = {
  w_c: 1.0, // completion
  w_r: 0.5, // returned within window
  w_m: 0.3, // monetization event
  w_p: 2.0, // canon or quality penalty (subtracted)
} as const;

// Attribution window for the delayed "returned" signal. RATIFIED 2026-06-15 with the weights above.
export const RETURN_WINDOW_DAYS = 7;

// =====================================================================================================
// CONTROL HOLDOUT  (OPERATIONAL DEFAULT) -- RATIFIED 2026-06-15 (accepted as-is).
// 10 percent global permanent control that always receives the director's cut. Per open decision 10.2.
// Realized share drifts on small finite id sets (design 6); measure the actual share in production, do
// not trust the nominal.
// =====================================================================================================
export const CONTROL_HOLDOUT_PCT = 10;

// =====================================================================================================
// EXPLAINABILITY BAR  (LEGAL / EU AI ACT POSTURE) -- THE ONE REMAINING PLACEHOLDER, awaits counsel.
// PLACEHOLDER: awaits legal ratification, do not ship to production unratified.
// Every served decision must be able to emit its top-N contributing NAMED features plus the canon
// filter that bounded the arm set. The phase-3 sequence model is gated behind a saliency method that
// meets this same bar. Per open decision 10.3. TOP_N is the bar's width.
// =====================================================================================================
export const EXPLAINABILITY_TOP_N = 3;

// ---- Non-placeholder engine tunables (engineering defaults, safe to change without ratification) ----

// LinUCB exploration coefficient (alpha). Higher = more exploration. Logged inside policy_version so
// off-policy evaluation can attribute decisions to the exact exploration setting. Dial down as
// confidence grows.
export const EXPLORATION_ALPHA = 1.0;

// EMA smoothing factor for folding new beat signals into the per-viewer preference vector.
export const EMA_ALPHA = 0.3;

// Hard serving timeout. On breach, opt-out, or any error, the handler returns the director's cut.
// The contract's latency budget is p99 < 50ms; this is the fail-safe ceiling, not the target.
export const SERVE_TIMEOUT_MS = 50;

// Top-k prefetch hints returned to the player to buffer for the seamless switch.
export const PREFETCH_TOP_K = 3;

// Stable identifier of this policy build. The bandit appends the exploration setting so a logged
// decision is attributable to the exact configuration at decision time.
export const POLICY_BASE_VERSION = "linucb-0.1.0";
export function policyVersion(): string {
  return `${POLICY_BASE_VERSION}+alpha=${EXPLORATION_ALPHA}`;
}
