// Spec test for P11. The brand-safety gate fails closed (rating, exclusions, competitor conflict); the
// content/ad plane firewall blocks an ad-CTR signal from driving cut selection; placement selection picks
// a safety-passed bid with an honest propensity and never an unsafe one; the marketplace matches eligible
// campaigns. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPlacementSafety, type SceneContext } from "./safety.js";
import { assertNotAdPlaneDriven, selectPlacement, AD_PLANE_SIGNALS, type EligiblePlacement } from "./placement.js";
import { eligibleCampaigns, toBidCandidates, budgetRemaining, type Campaign } from "./marketplace.js";

describe("brand-safety gate (fails closed)", () => {
  it("blocks an adult-only category in a non-adult scene", () => {
    const r = checkPlacementSafety({ brandId: "b1", category: "alcohol" }, { rating: "PG" });
    assert.equal(r.ok, false);
  });
  it("blocks an excluded category and a competitor conflict", () => {
    assert.equal(checkPlacementSafety({ brandId: "b1", category: "soda" }, { rating: "PG", excludedCategories: ["soda"] }).ok, false);
    const conflict: SceneContext = { rating: "R", competitorBrandIds: ["rival"], existingBrandIds: ["rival"] };
    assert.equal(checkPlacementSafety({ brandId: "b1", category: "soda" }, conflict).ok, false);
  });
  it("passes a clean placement", () => {
    assert.equal(checkPlacementSafety({ brandId: "b1", category: "soda" }, { rating: "PG" }).ok, true);
  });
});

describe("content/ad plane firewall", () => {
  it("throws if an ad-plane signal would drive cut selection", () => {
    for (const s of AD_PLANE_SIGNALS) {
      assert.throws(() => assertNotAdPlaneDriven(["completion", s]), /plane firewall/);
    }
  });
  it("allows retention features to drive cut selection", () => {
    assert.doesNotThrow(() => assertNotAdPlaneDriven(["completion", "return", "watch_fraction"]));
  });
});

describe("placement selection", () => {
  const scene: SceneContext = { rating: "PG" };
  const candidates: EligiblePlacement[] = [
    { placement: { brandId: "soda", category: "soda" }, bidUsd: 5 },
    { placement: { brandId: "booze", category: "alcohol" }, bidUsd: 100 }, // unsafe in PG, must be skipped
  ];
  it("never selects an unsafe placement even at a higher bid", () => {
    const sel = selectPlacement({ beatVariantId: "v1", slotId: "s1" }, candidates, scene, 0, () => 0.9);
    assert.equal(sel?.brandId, "soda"); // the unsafe higher bid is filtered out
    assert.equal(sel?.propensity, 1);
  });
  it("returns null when no candidate is safe (slot renders brand-free)", () => {
    const onlyUnsafe: EligiblePlacement[] = [{ placement: { brandId: "booze", category: "alcohol" }, bidUsd: 100 }];
    assert.equal(selectPlacement({ beatVariantId: "v1", slotId: "s1" }, onlyUnsafe, scene, 0, () => 0.9), null);
  });
});

describe("self-serve marketplace", () => {
  const scene: SceneContext = { rating: "PG13" };
  const campaigns: Campaign[] = [
    { id: "c1", brandId: "soda", category: "soda", budgetUsd: 100, spentUsd: 0, maxBidUsd: 5, targetRatings: ["PG13", "R"] },
    { id: "c2", brandId: "booze", category: "alcohol", budgetUsd: 100, spentUsd: 0, maxBidUsd: 50, targetRatings: ["PG13"] }, // unsafe
    { id: "c3", brandId: "shoes", category: "apparel", budgetUsd: 3, spentUsd: 0, maxBidUsd: 5, targetRatings: ["PG13"] }, // out of budget
    { id: "c4", brandId: "car", category: "auto", budgetUsd: 100, spentUsd: 0, maxBidUsd: 8, targetRatings: ["G"] }, // wrong rating
  ];
  it("matches only campaigns that target the rating, have budget, and pass safety", () => {
    const eligible = eligibleCampaigns(campaigns, scene);
    assert.deepEqual(eligible.map((c) => c.id), ["c1"]);
    assert.equal(budgetRemaining(campaigns[2]), 3);
    assert.deepEqual(toBidCandidates(eligible)[0], { placement: { brandId: "soda", category: "soda" }, bidUsd: 5 });
  });
});
