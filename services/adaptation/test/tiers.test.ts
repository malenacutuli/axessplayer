// Tier classifier + confidence scorer units. The hard guarantees: Tier A can be one-click, Tier B caps at
// preview+review (never one-click), Tier C is forced to low confidence + require-prompt regardless of the
// raw score. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { tierOf, isCapability, touchesLikeness, ALL_CAPABILITIES } from "../src/tiers.js";
import { scoreConfidence, rawScore } from "../src/confidence.js";

test("capability taxonomy maps every capability to a tier", () => {
  for (const cap of ALL_CAPABILITIES) {
    assert.ok(["A", "B", "C"].includes(tierOf(cap)));
  }
  assert.equal(tierOf("vertical_reframe"), "A");
  assert.equal(tierOf("lip_sync"), "B");
  assert.equal(tierOf("actor_replacement"), "C");
});

test("isCapability rejects unknowns", () => {
  assert.equal(isCapability("vertical_reframe"), true);
  assert.equal(isCapability("teleport"), false);
  assert.equal(isCapability(42), false);
});

test("Tier A with high signals is one-click", () => {
  const r = scoreConfidence("vertical_reframe", { sourceQuality: 0.95, preconditionCoverage: 0.95, adapterReliability: 0.95 });
  assert.equal(r.tier, "A");
  assert.equal(r.band, "high");
  assert.equal(r.mode, "one_click");
  assert.equal(r.lowConfidenceFlagged, false);
});

test("Tier B never reaches one-click even with perfect signals", () => {
  const r = scoreConfidence("lip_sync", { sourceQuality: 1, preconditionCoverage: 1, adapterReliability: 1 });
  assert.equal(r.tier, "B");
  assert.notEqual(r.mode, "one_click");
  assert.equal(r.band, "medium");
});

test("Tier C is forced to low confidence and require-prompt no matter the score", () => {
  const r = scoreConfidence("actor_replacement", { sourceQuality: 1, preconditionCoverage: 1, adapterReliability: 1 });
  assert.equal(r.tier, "C");
  assert.equal(r.band, "low");
  assert.equal(r.mode, "require_prompt");
  assert.equal(r.lowConfidenceFlagged, true);
  // raw score is high, but the tier cap overrides it.
  assert.ok(rawScore({ sourceQuality: 1, preconditionCoverage: 1, adapterReliability: 1 }) >= 0.8);
});

test("likeness/voice capabilities are flagged", () => {
  assert.equal(touchesLikeness("dub"), true);
  assert.equal(touchesLikeness("lip_sync"), true);
  assert.equal(touchesLikeness("actor_replacement"), true);
  assert.equal(touchesLikeness("vertical_reframe"), false);
});
