// Unit tests for the branch-as-quest pure domain logic (25-D4): the anti-dark-pattern invariants that ANY
// path unlocks, earning is idempotent, the FIRST path is the satisfier, and the community goal aggregates
// without self-inflation. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyProgress, earnPath, contributeToGoal } from "../src/quest.js";
import type { CommunityGoal } from "../src/store.js";

const NOW = 1_000_000;

test("earnPath unlocks and records the first path as the satisfier", () => {
  const p0 = emptyProgress("u1", "b1", NOW);
  assert.equal(p0.unlocked, false);
  const p1 = earnPath(p0, "watch_ad", NOW);
  assert.equal(p1.unlocked, true);
  assert.equal(p1.satisfiedPath, "watch_ad");
  assert.deepEqual(p1.pathsSeen, ["watch_ad"]);
});

test("earnPath is idempotent on a repeated path", () => {
  const p1 = earnPath(emptyProgress("u1", "b1", NOW), "spend", NOW);
  const p2 = earnPath(p1, "spend", NOW + 1);
  assert.deepEqual(p2.pathsSeen, ["spend"]);
  assert.equal(p2.satisfiedPath, "spend");
});

test("a later distinct path is recorded but does not overwrite the satisfier", () => {
  const p1 = earnPath(emptyProgress("u1", "b1", NOW), "invite", NOW);
  const p2 = earnPath(p1, "watch_ad", NOW + 1);
  assert.equal(p2.satisfiedPath, "invite"); // first one stays the satisfier
  assert.deepEqual(p2.pathsSeen.sort(), ["invite", "watch_ad"]);
});

test("contributeToGoal aggregates and is idempotent per contributor (no self-inflation)", () => {
  const g0: CommunityGoal = { branchId: "b", targetCount: 2, currentCount: 0, contributors: [], met: false };
  const a = contributeToGoal(g0, "userA");
  assert.equal(a.counted, true);
  assert.equal(a.goal.currentCount, 1);
  assert.equal(a.goal.met, false);

  // Same contributor again: not counted, no advance.
  const aDup = contributeToGoal(a.goal, "userA");
  assert.equal(aDup.counted, false);
  assert.equal(aDup.goal.currentCount, 1);

  // A second distinct contributor meets the goal.
  const b = contributeToGoal(a.goal, "userB");
  assert.equal(b.goal.currentCount, 2);
  assert.equal(b.goal.met, true);
  assert.equal(b.nowMet, true);

  // A third contributor after met: counted, but nowMet is false (already met).
  const c = contributeToGoal(b.goal, "userC");
  assert.equal(c.goal.met, true);
  assert.equal(c.nowMet, false);
});
