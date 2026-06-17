// P6-T3 bandit-optimizable paywall. The bandit picks WHICH offer to present per viewer to maximize
// conversion (a surrogate), epsilon-greedy, with a logged propensity so paywall offers are themselves
// off-policy evaluable. It selects among a FIXED, founder-approved offer set and never changes the price a
// viewer pays after presentation (no dark patterns). The offer set + prices are flagged for the
// money/ledger sign-off. No em dashes.

export type Offer = { id: string; coins: number; priceUsd: number };

// FLAGGED for the money/ledger founder sign-off (prices, packs). Web/Studio purchasing only (the mobile
// IAP tax means real purchasing stays where the margin survives, CORRECTIONS C8).
export const DEFAULT_OFFERS: Offer[] = [
  { id: "pack_small", coins: 50, priceUsd: 4.99 },
  { id: "pack_medium", coins: 120, priceUsd: 9.99 },
  { id: "pack_large", coins: 300, priceUsd: 19.99 },
];

export type OfferSelection = { offerId: string; propensity: number; explored: boolean };

// Epsilon-greedy over offers by estimated conversion. Greedy = argmax conversion estimate; explore picks
// uniformly. Logged propensity: greedy offer = 1-eps+eps/k, any other = eps/k (strictly positive for IPS).
export function selectOffer(
  offers: Offer[],
  conversionByOffer: Record<string, number>,
  epsilon: number,
  rng: () => number,
): OfferSelection {
  if (offers.length === 0) throw new Error("selectOffer: no offers");
  const k = offers.length;
  let greedy = offers[0];
  let best = -Infinity;
  for (const o of offers) {
    const c = conversionByOffer[o.id] ?? 0;
    if (c > best) {
      best = c;
      greedy = o;
    }
  }
  let chosen: Offer;
  if (rng() < epsilon) {
    chosen = offers[Math.min(k - 1, Math.floor(rng() * k))];
  } else {
    chosen = greedy;
  }
  const isGreedy = chosen.id === greedy.id;
  return { offerId: chosen.id, propensity: isGreedy ? 1 - epsilon + epsilon / k : epsilon / k, explored: !isGreedy };
}

// ---------- PATH-LEVEL paywall bandit (buy / watch_ad / subscribe) ----------
// Picks which path to FEATURE per viewer, logged with propensity so the choice is off-policy evaluable.
// The reward-weights founder sign-off (2026-06-17) is GRANTED, so the bandit may optimize on the ratified
// reward (viewer continuation). Two things stay HARD regardless of any sign-off: revenue EXTRACTION is never
// the objective (REVENUE_OPTIMIZATION_ENABLED is permanently false), and the anti-dark-pattern constraints
// below are hard. watch_ad leads the default order (the pro-viewer, no-spend option first), so with neutral
// reward weights the featured path is the free one until observed continuation data shifts it.

export type PaywallPath = "watch_ad" | "buy" | "subscribe";
export const PAYWALL_PATHS: PaywallPath[] = ["watch_ad", "buy", "subscribe"];

// PERMANENT hard rule: the bandit never optimizes for revenue extraction, signed off or not.
export const REVENUE_OPTIMIZATION_ENABLED = false;

// Reward-weights founder sign-off: GRANTED. Gates whether the bandit optimizes on the continuation reward
// (true) or runs neutral/DRAFT (false). Extraction stays off either way.
export const REWARD_WEIGHTS_SIGNED_OFF = true;

// Reward weights over paths (the ratified reward is viewer continuation, NOT revenue). Neutral defaults so
// the featured path stays the pro-viewer watch_ad until observed continuation data accrues. Never set from
// price or revenue (that would be extraction, which is permanently off).
export const PATH_REWARD_WEIGHTS: Record<PaywallPath, number> = { watch_ad: 1, buy: 1, subscribe: 1 };
// Back-compat alias.
export const DRAFT_PATH_WEIGHTS = PATH_REWARD_WEIGHTS;

// Anti-dark-pattern HARD constraints (not preferences): a spend cool-down prevents rapid repeated purchase
// prompts; pricing is always shown up front (the offer/tier objects carry the real price); the bandit never
// changes a price after presentation. The cool-down is enforced server-side before a paywall is re-shown.
export const SPEND_COOLDOWN_MS = 60_000;
export function withinSpendCooldown(lastSpendAtMs: number | null, nowMs: number): boolean {
  return lastSpendAtMs != null && nowMs - lastSpendAtMs < SPEND_COOLDOWN_MS;
}

// optimized: the bandit is using the reward weights (post sign-off). revenueOptimized: ALWAYS false, a
// permanent invariant the UI surfaces to the viewer (the bandit never optimizes for revenue extraction).
export type PathSelection = { path: PaywallPath; propensity: number; explored: boolean; optimized: boolean; revenueOptimized: boolean };

export function selectPaywallPath(
  paths: PaywallPath[],
  weightByPath: Record<string, number>,
  epsilon: number,
  rng: () => number,
): PathSelection {
  if (paths.length === 0) throw new Error("selectPaywallPath: no paths");
  const k = paths.length;
  // Neutral only before the reward-weights sign-off. Post sign-off the bandit optimizes on the continuation
  // reward weights. Either way it never weights by price/revenue (extraction is permanently off).
  const neutral = !REWARD_WEIGHTS_SIGNED_OFF;
  let greedy = paths[0];
  if (!neutral) {
    let best = -Infinity;
    for (const p of paths) {
      const w = weightByPath[p] ?? 0;
      if (w > best) {
        best = w;
        greedy = p;
      }
    }
  }
  let chosen: PaywallPath;
  if (neutral || rng() < epsilon) {
    chosen = paths[Math.min(k - 1, Math.floor(rng() * k))];
  } else {
    chosen = greedy;
  }
  const isGreedy = !neutral && chosen === greedy;
  // Propensity: neutral mode is uniform 1/k; optimized mode is epsilon-greedy. Both strictly positive (IPS).
  const propensity = neutral ? 1 / k : isGreedy ? 1 - epsilon + epsilon / k : epsilon / k;
  // optimized reflects whether the bandit used the reward weights; revenueOptimized is the permanent
  // invariant (always false: extraction is never the objective).
  return { path: chosen, propensity, explored: !isGreedy, optimized: !neutral, revenueOptimized: REVENUE_OPTIMIZATION_ENABLED };
}

// Subscription tiers (GOLD_STANDARD_04). FLAGGED for the money/ledger sign-off; web/Studio purchasing only
// (the mobile IAP tax, CORRECTIONS C8). Prices are transparent and carried to the UI verbatim.
export type SubTier = { id: string; label: string; priceUsd: number; coinsPerMonth: number };
export const SUBSCRIPTION_TIERS: SubTier[] = [
  { id: "tier_basic", label: "Basic", priceUsd: 4.99, coinsPerMonth: 60 },
  { id: "tier_plus", label: "Plus", priceUsd: 9.99, coinsPerMonth: 150 },
  { id: "tier_pro", label: "Pro", priceUsd: 19.99, coinsPerMonth: 350 },
];
