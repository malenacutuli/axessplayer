// Assignment logic for the ONLINE experiment serving tier (Slice B): the pure functions behind the
// /assign and /ending endpoints. Determinism is the contract: a (unit, experiment) pair always lands in
// the same variant, so a viewer never flickers between arms across requests or restarts. Built on the
// pure bandit core (bucketOf + epsilonGreedy). No node:http here. No em dashes.

import { ASSIGNMENT_SALT, BUCKET_COUNT, DEFAULT_EPSILON } from "./config.js";
import {
  bucketOf,
  epsilonGreedy,
  mulberry32,
  fnv1a32,
  type Arm,
  type ArmSelection,
} from "./bandit-core.js";

// A variant in a deterministic split: an id and a weight. Weights need not sum to 1; they are normalized.
export type Variant = { id: string; weight: number };

export type Assignment = {
  unit: string;
  experiment: string;
  variant: string;
  // The deterministic bucket the unit fell in, logged so an assignment is reproducible and auditable.
  bucket: number;
  // P(variant | unit, experiment) under the deterministic split, for off-policy bookkeeping. For a pure
  // hash split this is the variant's normalized weight (the share of units that map to it).
  propensity: number;
};

// Deterministic weighted assignment: hash the unit into [0, 1) and walk the cumulative weight intervals.
// The same triple always returns the same variant. Propensity is the variant's normalized weight.
export function assignDeterministic(
  unit: string,
  experiment: string,
  variants: Variant[],
  salt: string = ASSIGNMENT_SALT
): Assignment {
  if (variants.length === 0) throw new Error("no_variants");
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) throw new Error("zero_total_weight");

  const b = bucketOf(unit, experiment, salt, BUCKET_COUNT);
  const target = b.floatBucket * total;

  let acc = 0;
  for (const v of variants) {
    acc += Math.max(0, v.weight);
    if (target < acc) {
      return {
        unit,
        experiment,
        variant: v.id,
        bucket: b.intBucket,
        propensity: Math.max(0, v.weight) / total,
      };
    }
  }
  // Floating-point edge: target == total. Fall to the last variant.
  const last = variants[variants.length - 1];
  return {
    unit,
    experiment,
    variant: last.id,
    bucket: b.intBucket,
    propensity: Math.max(0, last.weight) / total,
  };
}

// Bandit-style assignment over an arm set, for experiments that want exploration rather than a fixed
// split. The RNG is seeded from (unit, experiment, salt) so the explore/exploit flip is itself
// deterministic per unit: the same unit always gets the same arm, but the population still explores at
// rate epsilon. Reward-gated: while unsigned, the exploit branch is reward-insensitive (see bandit-core).
export function assignBandit(
  unit: string,
  experiment: string,
  arms: Arm[],
  epsilon: number = DEFAULT_EPSILON,
  salt: string = ASSIGNMENT_SALT
): ArmSelection & { unit: string; experiment: string } {
  const seed = fnv1a32(`${unit}|${experiment}|${salt}|bandit`);
  const sel = epsilonGreedy(arms, epsilon, mulberry32(seed));
  return { ...sel, unit, experiment };
}
