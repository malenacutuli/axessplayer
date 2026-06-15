// Decision engine configuration. Single source of truth for the tunables.
// THREE of these are PLACEHOLDERS that await human ratification before production. They are isolated
// here so ratifying each is a one-line change, not a code hunt. Do NOT optimize reward shaping against
// the placeholder weights in this cut. No em dashes.

// =====================================================================================================
// PLACEHOLDER 1: REWARD WEIGHTS  (PRODUCT / BUSINESS CALL, awaits human ratification)
// PLACEHOLDER: awaits human ratification, do not ship to production unratified.
// Per W3_DECISION_DESIGN.md section 3 and open decision 10.1. These are a defensible completion-first
// start (w_c dominant, w_m deliberately small so the engine does not learn to paywall-bait). Each
// signal is normalized to [0,1] before weighting (see normalizeSignals) so the largest-magnitude
// signal does not silently win. Reward shaping is NOT finalized or optimized against these in scaffold
// mode; the offline trainer (a stubbed interface here) consumes them once a human ratifies.
// =====================================================================================================
export const REWARD_WEIGHTS = {
  w_c: 1.0, // completion
  w_r: 0.5, // returned within window
  w_m: 0.3, // monetization event
  w_p: 2.0, // canon or quality penalty (subtracted)
} as const;

// Attribution window for the delayed "returned" signal. Product call, ratified with the weights above.
// PLACEHOLDER: awaits human ratification, do not ship to production unratified.
export const RETURN_WINDOW_DAYS = 7;

// =====================================================================================================
// PLACEHOLDER 2: CONTROL HOLDOUT  (OPERATIONAL DEFAULT, fine to keep)
// PLACEHOLDER: awaits human ratification, do not ship to production unratified.
// 10 percent global permanent control that always receives the director's cut. Per open decision 10.2.
// This is the only one of the three that is a sane operational default to keep as-is; it is flagged for
// completeness so all three live together. Realized share drifts on small finite id sets (design 6);
// measure the actual share in production, do not trust the nominal.
// =====================================================================================================
export const CONTROL_HOLDOUT_PCT = 10;

// =====================================================================================================
// PLACEHOLDER 3: EXPLAINABILITY BAR  (LEGAL / EU AI ACT POSTURE, awaits human ratification)
// PLACEHOLDER: awaits human ratification, do not ship to production unratified.
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
