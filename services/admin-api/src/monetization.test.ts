// Monetization read-model tests. Assert the pricing-rule read model, the observed ledger fold, and the
// HARD GATE that reward weights are DISPLAY-ONLY (never editable, never read as a tunable). No live
// Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { monetizationLedgerSql, episodePriceDistributionSql, variantPriceDistributionSql } from "./queries.js";
import { buildMonetization, DEFAULT_PRICING_RULES, REWARD_WEIGHTS_DISPLAY } from "./monetization.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("monetization ledger SQL reads coin_transactions only; price distributions are catalog reads", () => {
  assert.match(monetizationLedgerSql().text, /from coin_transactions group by type/);
  assert.match(episodePriceDistributionSql().text, /from episodes where coin_cost is not null/);
  assert.match(variantPriceDistributionSql().text, /from beat_variants where is_premium/);
});

test("DEFAULT_PRICING_RULES covers packs, subs, and premium cut, all source 'default'", () => {
  const kinds = new Set(DEFAULT_PRICING_RULES.map((r) => r.kind));
  assert.ok(kinds.has("coin_pack"));
  assert.ok(kinds.has("subscription"));
  assert.ok(kinds.has("premium_cut"));
  for (const r of DEFAULT_PRICING_RULES) assert.equal(r.source, "default");
});

test("buildMonetization returns the rule set, folds the observed ledger, and surfaces display-only reward weights", async () => {
  const db = fakePg([
    { match: /from coin_transactions group by type/, rows: [{ type: "iap", count: 12, credited: 1200, spent: 0 }, { type: "spend", count: 30, credited: 0, spent: 900 }] },
    { match: /from episodes where coin_cost/, rows: [{ coin_cost: 20, episodes: 4 }] },
    { match: /from beat_variants where is_premium/, rows: [{ coin_cost: 30, variants: 8 }] },
  ]);
  const m = await buildMonetization(db);
  assert.equal(m.rules.length, DEFAULT_PRICING_RULES.length);
  assert.equal(m.rulesSource, "default");
  assert.equal(m.observedLedger.length, 2);
  assert.equal(m.observedLedger[0].type, "iap");
  assert.equal(m.observedPrices.episodes[0].coinCost, 20);
  assert.equal(m.observedPrices.premiumVariants[0].variants, 8);

  // HARD GATE: reward weights are display-only and not editable.
  assert.equal(m.rewardWeights.editable, false);
  assert.equal(m.rewardWeights.status, "draft");
});

test("HARD GATE: the reward-weights display constant exposes NO numeric weight and is never editable", () => {
  // The display marker must not carry any tunable numeric weight field that an operator could PATCH.
  assert.equal(REWARD_WEIGHTS_DISPLAY.editable, false);
  const serialized = JSON.stringify(REWARD_WEIGHTS_DISPLAY);
  assert.doesNotMatch(serialized, /w_c|w_r|w_m|"weight"|weights\s*:/i);
  // Only status/editable/note keys exist; no "value"/"weights" array to mutate.
  assert.deepEqual(Object.keys(REWARD_WEIGHTS_DISPLAY).sort(), ["editable", "note", "status"]);
});
