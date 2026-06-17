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
