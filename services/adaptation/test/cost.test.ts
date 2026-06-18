// Cost gate units. Over-budget pauses; null budget never pauses; Tier C is dramatically more expensive
// than Tier A. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateCost } from "../src/cost.js";

test("a null budget never reports over-budget", () => {
  const e = estimateCost("actor_replacement", 600000, null);
  assert.equal(e.overBudget, false);
  assert.ok(e.estimatedUsd > 0);
});

test("an over-budget estimate is flagged", () => {
  const e = estimateCost("actor_replacement", 600000, 1); // 10 min of actor replacement, budget $1
  assert.equal(e.overBudget, true);
});

test("a within-budget estimate is not flagged", () => {
  const e = estimateCost("vertical_reframe", 600000, 100);
  assert.equal(e.overBudget, false);
});

test("Tier C costs far more than Tier A for the same source", () => {
  const a = estimateCost("vertical_reframe", 600000, null);
  const c = estimateCost("actor_replacement", 600000, null);
  assert.ok(c.estimatedUsd > a.estimatedUsd * 10);
});
