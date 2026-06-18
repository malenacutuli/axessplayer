// Monetization read model for GET /admin/monetization. The pricing config lives in the LIVE economy /
// settlement services (NOT imported or edited here). This aggregate returns a READ MODEL composed of:
//   1. the DOCUMENTED DEFAULT pricing rule set (coin packs, subscription tiers, premium-cut / rewarded-ad /
//      promo / regional rules) as a constant with a source flag, so the console renders the configured
//      rules without reaching into a live service; and
//   2. the OBSERVED ledger (coin_transactions types + volume) and the observed content prices, so an
//      operator can see which rules are actually transacting.
// Reward-function weights are returned DISPLAY-ONLY as a constant DRAFT marker with rewardWeightsEditable
// false: a weight change is a founder sign-off, never an operator/agent action, and there is NO route that
// writes them. Pricing-edit routes are 501 RBAC-gated audit seams in http/app.ts. No em dashes.

import type { QueryPort } from "./aggregate.js";
import {
  monetizationLedgerSql,
  episodePriceDistributionSql,
  variantPriceDistributionSql,
  type Sql,
} from "./queries.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// A single pricing rule in the read model. price is in the rule's unit (coins for packs/premium, minor
// currency units for subs). source flags WHERE the value comes from: "default" is the documented rule set
// baked into this read model; "hosted" would be a value read from a live config table once one is wired.
export interface PricingRule {
  id: string;
  kind: "coin_pack" | "subscription" | "premium_cut" | "rewarded_ad" | "promo" | "regional";
  label: string;
  // The configured amount. Coins for coin_pack/premium_cut, currency minor units for subscription, a coin
  // grant for rewarded_ad, a percent for promo, a multiplier for regional. unit disambiguates.
  amount: number;
  unit: "coins" | "currency_minor" | "percent" | "multiplier";
  source: "default" | "hosted";
  note?: string;
}

// The DOCUMENTED DEFAULT rule set. This is the product's documented pricing, surfaced read-only so the
// console always has a complete rule list even though the live economy service owns the authoritative
// config. These are NOT live Stripe prices; Stripe is TEST. A real hosted-config read swaps source to
// "hosted" without a shape change.
export const DEFAULT_PRICING_RULES: PricingRule[] = [
  { id: "pack_small", kind: "coin_pack", label: "Starter pack", amount: 100, unit: "coins", source: "default" },
  { id: "pack_medium", kind: "coin_pack", label: "Standard pack", amount: 550, unit: "coins", source: "default" },
  { id: "pack_large", kind: "coin_pack", label: "Value pack", amount: 1200, unit: "coins", source: "default" },
  { id: "sub_monthly", kind: "subscription", label: "Monthly", amount: 999, unit: "currency_minor", source: "default", note: "Stripe TEST; live billing is unwired" },
  { id: "sub_annual", kind: "subscription", label: "Annual", amount: 9999, unit: "currency_minor", source: "default", note: "Stripe TEST; live billing is unwired" },
  { id: "premium_cut", kind: "premium_cut", label: "Premium cut unlock", amount: 30, unit: "coins", source: "default", note: "per-variant price is server-set in the catalog; see observed prices" },
  { id: "rewarded_ad", kind: "rewarded_ad", label: "Rewarded ad grant", amount: 10, unit: "coins", source: "default", note: "neutral grant; content/ad firewall holds" },
  { id: "promo_welcome", kind: "promo", label: "Welcome promo", amount: 100, unit: "percent", source: "default", note: "match on first purchase; promo backend unwired" },
  { id: "regional_default", kind: "regional", label: "Regional multiplier (default)", amount: 1, unit: "multiplier", source: "default", note: "regional pricing not yet configured per region" },
];

// Reward weights, DISPLAY-ONLY. A constant neutral/DRAFT marker. There is no value to edit and no route to
// edit it: a reward-weight change is a founder sign-off. The console renders this read-only with the note.
export interface RewardWeightsDisplay {
  status: "draft";
  editable: false;
  note: string;
}

export const REWARD_WEIGHTS_DISPLAY: RewardWeightsDisplay = {
  status: "draft",
  editable: false,
  note: "reward-function weights are DRAFT and display-only; a change is a founder sign-off, never an operator or agent action",
};

export interface MonetizationView {
  rules: PricingRule[];
  // The ledger types observed transacting, so an operator sees which rules are actually firing.
  observedLedger: Array<{ type: string; count: number; credited: number; spent: number }>;
  // Observed content prices (server-set), as distributions, not per-row data.
  observedPrices: {
    episodes: Array<{ coinCost: number; episodes: number }>;
    premiumVariants: Array<{ coinCost: number; variants: number }>;
  };
  rewardWeights: RewardWeightsDisplay;
  // Source flag for the rule set: "default" until a hosted pricing-config table is wired.
  rulesSource: "default" | "hosted";
  note: string;
}

export async function buildMonetization(db: QueryPort): Promise<MonetizationView> {
  const [ledger, episodePrices, variantPrices] = await Promise.all([
    run<{ type: string; count: number; credited: number; spent: number }>(db, monetizationLedgerSql()),
    run<{ coin_cost: number; episodes: number }>(db, episodePriceDistributionSql()),
    run<{ coin_cost: number; variants: number }>(db, variantPriceDistributionSql()),
  ]);

  return {
    rules: DEFAULT_PRICING_RULES,
    observedLedger: ledger.map((r) => ({ type: r.type, count: num(r.count), credited: num(r.credited), spent: num(r.spent) })),
    observedPrices: {
      episodes: episodePrices.map((r) => ({ coinCost: num(r.coin_cost), episodes: num(r.episodes) })),
      premiumVariants: variantPrices.map((r) => ({ coinCost: num(r.coin_cost), variants: num(r.variants) })),
    },
    rewardWeights: REWARD_WEIGHTS_DISPLAY,
    rulesSource: "default",
    note: "pricing rules are the documented default read model; the live economy service owns authoritative config. Pricing edits are 501 RBAC-gated audit seams (mutation backend unwired)",
  };
}
