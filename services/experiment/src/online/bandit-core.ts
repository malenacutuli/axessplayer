// Pure, testable bandit core for the ONLINE experiment serving tier (Slice B). This is the home for
// A/B assignment, creative-test selection, poster-CTR selection, and ending-test assignment that the
// INTERACTION_MAP places in services/experiment (today spread across prompts 03/04/15). It is a pure
// module: no node:http, no pg, no clock, no global RNG. Determinism comes from an injected seed, so the
// node:test suite can pin every decision. No em dashes.
//
// HARD GATE (founder sign-off): the selection core MUST NOT optimize a revenue/extraction objective.
// REWARD_WEIGHTS_SIGNED_OFF is false, so getWeights() is DISPLAY-ONLY and the arm scorer applies a
// NEUTRAL reward (every arm scored identically on the reward axis) until a founder sign-off flips the
// flag. Concretely: while unsigned, the epsilon-greedy core never lets a measured CTR/CPA/monetization
// number move the exploit ranking. It explores uniformly and, on the exploit branch, tie-breaks
// deterministically by arm id. This is what keeps the bandit from learning a paywall-baiting policy
// before a human ratifies the weights.

// =====================================================================================================
// REWARD WEIGHTS GATE
// =====================================================================================================

// The sign-off flag. FALSE here, intentionally. Flipping this to true is a FOUNDER decision, not an
// engineering one, and must be paired with ratified weights. Until then the core optimizes on nothing
// reward-sensitive. Do NOT default this to true.
export const REWARD_WEIGHTS_SIGNED_OFF = false as const;

// Neutral, display-only reward weights. These are NOT a business call: while unsigned they are all zero
// so no signal (CTR, CPA, completion, monetization) can tilt the exploit ranking. getWeights() returns
// them for dashboards/explainability ONLY; the scorer below ignores them while unsigned.
export type RewardWeights = {
  ctr: number; // click-through rate axis
  cpa: number; // cost-per-action axis (lower is "better"; sign handled by the scorer when signed)
  completion: number; // near-term completion axis
};

const NEUTRAL_WEIGHTS: RewardWeights = { ctr: 0, cpa: 0, completion: 0 } as const;

// DISPLAY-ONLY accessor. Returns the neutral weights while unsigned. A signed deployment would return
// ratified weights here, but the scorer still gates on REWARD_WEIGHTS_SIGNED_OFF, so reading these for a
// dashboard never silently activates them. Never wire this return value straight into a spend decision.
export function getWeights(): RewardWeights {
  // While unsigned the weights are neutral by construction. The branch is explicit so a future signed
  // build is a one-line change paired with the founder flag, not a code hunt.
  return REWARD_WEIGHTS_SIGNED_OFF ? NEUTRAL_WEIGHTS : NEUTRAL_WEIGHTS;
}

// =====================================================================================================
// DETERMINISTIC RNG
// =====================================================================================================

// A small, deterministic PRNG (mulberry32) plus a stable string hash (FNV-1a 32-bit). No global state,
// no Math.random, so a given seed yields the same stream forever. Used both for unit-bucket hashing
// (deterministic assignment) and for the epsilon explore/exploit coin flip (seeded exploration).

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number; // yields a float in [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================================================================
// DETERMINISTIC A/B BUCKETING
// =====================================================================================================

// A deterministic bucket for (unit, experiment) under a salt. The same triple always lands in the same
// bucket, independent of order of calls or process restarts (this is the property the assignment endpoint
// needs). Returns a float bucket in [0, 1) and an integer bucket in [0, buckets). Salt namespaces an
// experiment so re-salting reshuffles assignment without renaming the experiment.
export type Bucket = { unit: string; experiment: string; floatBucket: number; intBucket: number };

export function bucketOf(
  unit: string,
  experiment: string,
  salt: string,
  buckets = 10000
): Bucket {
  const h = fnv1a32(`${unit}|${experiment}|${salt}`);
  const floatBucket = h / 4294967296;
  const intBucket = h % buckets;
  return { unit, experiment, floatBucket, intBucket };
}

// =====================================================================================================
// EPSILON-GREEDY ARM SELECTION (pure core)
// =====================================================================================================

// An arm carries its id, a measured reward estimate, an eligibility flag, and an "alwaysEligible" pin.
// The reward estimate is the ONLY field that could encode CTR/CPA, and it is IGNORED while unsigned.
export type Arm = {
  id: string;
  // Measured reward estimate in [0, 1] (e.g. observed CTR). DISPLAY/exploit-only and gated: never used
  // for ranking while REWARD_WEIGHTS_SIGNED_OFF is false.
  rewardEstimate: number;
  eligible: boolean;
  // An accessibility-first variant pins alwaysEligible=true so it can never be filtered out of a set.
  alwaysEligible?: boolean;
};

export type ArmSelection = {
  chosen: string;
  // P(chosen | arms, epsilon, signed), logged for honest off-policy evaluation. Strictly positive so IPS
  // never divides by zero.
  propensity: number;
  explored: boolean; // true if the epsilon branch (uniform explore) selected the arm
  // Whether the reward estimate was allowed to influence the exploit ranking. False while unsigned.
  rewardApplied: boolean;
};

// Compute the eligible arm set. An arm is eligible if eligible !== false OR it is alwaysEligible. The
// accessibility-first variant (alwaysEligible) is therefore ALWAYS in the candidate set, by construction.
export function eligibleArms(arms: Arm[]): Arm[] {
  return arms.filter((a) => a.alwaysEligible === true || a.eligible !== false);
}

// The exploit choice: while unsigned, reward is neutral so EVERY arm ties and the deterministic
// tie-break (lowest id) wins. Once signed, the highest rewardEstimate wins, tie-broken by lowest id.
function exploitChoice(arms: Arm[]): { id: string; rewardApplied: boolean } {
  const sorted = [...arms].sort((a, b) => {
    if (REWARD_WEIGHTS_SIGNED_OFF) {
      // Reward axis is live only after sign-off. Higher estimate first.
      if (b.rewardEstimate !== a.rewardEstimate) return b.rewardEstimate - a.rewardEstimate;
    }
    // Deterministic, reward-insensitive tie-break: lexicographically lowest id wins. While unsigned this
    // is the ONLY ordering, so no measured number can move the choice.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { id: sorted[0].id, rewardApplied: REWARD_WEIGHTS_SIGNED_OFF };
}

// Pure epsilon-greedy selection over the eligible arm set, driven by an injected RNG draw.
//   - With probability epsilon: EXPLORE, pick a uniformly random eligible arm.
//   - Otherwise: EXPLOIT, pick the exploit choice (gated by the sign-off flag, see exploitChoice).
// Determinism: the same (arms, epsilon, rng) yields the same selection. Propensity is the exact policy
// probability mass on the chosen arm under this mixture, so it is honest for IPS/DR estimators.
export function epsilonGreedy(arms: Arm[], epsilon: number, rng: Rng): ArmSelection {
  const pool = eligibleArms(arms);
  if (pool.length === 0) throw new Error("no_eligible_arms");
  const eps = Math.min(1, Math.max(0, epsilon));
  const n = pool.length;

  if (n === 1) {
    return { chosen: pool[0].id, propensity: 1, explored: false, rewardApplied: false };
  }

  const exploit = exploitChoice(pool);
  const flip = rng(); // first draw: explore vs exploit
  const explored = flip < eps;

  let chosen: string;
  if (explored) {
    const idx = Math.floor(rng() * n); // second draw: which arm to explore
    chosen = pool[Math.min(idx, n - 1)].id;
  } else {
    chosen = exploit.id;
  }

  // Propensity under the mixture: uniform-explore mass (eps/n) for every arm, plus the exploit mass
  // (1 - eps) on the single exploit arm. This is exact and strictly positive whenever eps > 0.
  const exploreMass = eps / n;
  const exploitMass = chosen === exploit.id ? 1 - eps : 0;
  const propensity = exploreMass + exploitMass;

  return { chosen, propensity, explored, rewardApplied: exploit.rewardApplied };
}

// =====================================================================================================
// CTR / CPA AGGREGATION (state the bandit reads, gated)
// =====================================================================================================

// Per-arm counters the creative and poster bandits accumulate from logged impressions/outcomes. The
// derived CTR is exposed for DASHBOARDS and, once signed, the exploit ranking. While unsigned it is
// display-only: epsilonGreedy ignores rewardEstimate, so these numbers never drive selection.
export type ArmStats = { impressions: number; clicks: number; conversions: number; cost: number };

export function emptyStats(): ArmStats {
  return { impressions: 0, clicks: 0, conversions: 0, cost: 0 };
}

// Laplace-smoothed CTR so a zero-impression arm reads as a neutral prior rather than 0 or NaN.
export function ctr(s: ArmStats): number {
  return (s.clicks + 1) / (s.impressions + 2);
}

// Cost-per-action. Returns null when there are no conversions (undefined, not zero, so a no-conversion
// arm is not mistaken for a free one).
export function cpa(s: ArmStats): number | null {
  return s.conversions > 0 ? s.cost / s.conversions : null;
}

// Build an Arm from accumulated stats. rewardEstimate is the (gated) CTR. eligible/alwaysEligible are
// carried through from the registry. Pure.
export function armFromStats(
  id: string,
  s: ArmStats,
  opts: { eligible?: boolean; alwaysEligible?: boolean } = {}
): Arm {
  return {
    id,
    rewardEstimate: ctr(s),
    eligible: opts.eligible ?? true,
    ...(opts.alwaysEligible ? { alwaysEligible: true } : {}),
  };
}
