// Prompt 01 / T3: context-free epsilon-greedy variant selection for the Treatment arm, with an honest
// logged propensity for off-policy evaluation. Control is a fixed showrunner pick (propensity 1.0).
// This is deliberately simpler than the contextual LinUCB (services/decision/src/bandit.ts); contextual
// personalization is Gate B / prompt 03. No em dashes.

export type Variant = { variantId: string };
export type Selection = {
  variantId: string;
  propensity: number; // P(served | policy), strictly positive so IPS never divides by zero
  explored: boolean;
  policyVersion: string;
};

export const POLICY_VERSION = "gatea-epsilon-greedy-v1";
export const CONTROL_POLICY_VERSION = "control-fixed-v1";

// mulberry32 deterministic PRNG seeded from a string, so a (viewer, session, beat) decision is
// reproducible and the experiment can be replayed exactly.
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Epsilon-greedy over a beat's variants. surrogateByVariant is the policy's current value estimate for
// each variant (mean surrogate reward). Greedy = argmax; with probability epsilon, explore uniformly
// over all k arms (the greedy arm included). The logged propensity is the true probability mass the
// policy placed on the served arm: greedy arm = (1-eps) + eps/k; any other arm = eps/k.
export function selectTreatment(
  variants: Variant[],
  surrogateByVariant: Record<string, number>,
  epsilon: number,
  rng: () => number,
): Selection {
  if (variants.length === 0) throw new Error("selectTreatment: no variants");
  const k = variants.length;
  let greedy = variants[0];
  let best = -Infinity;
  for (const v of variants) {
    const s = surrogateByVariant[v.variantId] ?? 0;
    if (s > best) {
      best = s;
      greedy = v;
    }
  }
  let chosen: Variant;
  if (rng() < epsilon) {
    const idx = Math.min(k - 1, Math.floor(rng() * k));
    chosen = variants[idx];
  } else {
    chosen = greedy;
  }
  const isGreedy = chosen.variantId === greedy.variantId;
  const propensity = isGreedy ? 1 - epsilon + epsilon / k : epsilon / k;
  return { variantId: chosen.variantId, propensity, explored: !isGreedy, policyVersion: POLICY_VERSION };
}

// Control arm: the designated showrunner variant every beat, with propensity 1.0 (deterministic policy).
export function controlImpression(controlVariantId: string): Selection {
  return { variantId: controlVariantId, propensity: 1.0, explored: false, policyVersion: CONTROL_POLICY_VERSION };
}
