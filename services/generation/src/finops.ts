// P10 / CORRECTIONS C16: the FinOps cost gate. Generation spends real GPU money, and nothing in the org
// otherwise bounds it, so spend is gated by a budget a human sets (the cost/FinOps sign-off). The default
// budget is ZERO: nothing generates until a budget is explicitly approved. Per-shot cost is a flagged
// placeholder for estimation. No em dashes.

export interface CostBudget {
  capUsd: number; // the approved ceiling for this run/window
  spentUsd: number; // already spent against it
}

// Default: deny everything. A budget must be opened (founder cost sign-off) before any generation runs.
export const DENY_ALL: CostBudget = { capUsd: 0, spentUsd: 0 };

// FLAGGED placeholder unit cost for estimation. Real per-model/per-second pricing is the cutover.
export const COST_PER_SHOT_USD = 0.5;

export function estimateSpecCostUsd(shots: number): number {
  return Math.max(0, shots) * COST_PER_SHOT_USD;
}

export type Authorization = { allowed: boolean; reason?: string; remainingUsd: number };

// Authorize a spend against the budget. A zero/negative estimate is refused (no blind spend), and an
// estimate over the remaining budget is refused. This is the hard ceiling that keeps an agent from racking
// up real money.
export function authorizeSpend(budget: CostBudget, estimateUsd: number): Authorization {
  const remaining = budget.capUsd - budget.spentUsd;
  if (!(estimateUsd > 0)) return { allowed: false, reason: "no positive cost estimate", remainingUsd: remaining };
  if (estimateUsd > remaining) {
    return { allowed: false, reason: `over budget (est $${estimateUsd.toFixed(2)}, remaining $${remaining.toFixed(2)})`, remainingUsd: remaining };
  }
  return { allowed: true, remainingUsd: remaining - estimateUsd };
}
