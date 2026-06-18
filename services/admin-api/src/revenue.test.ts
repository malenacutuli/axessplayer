// revenueShare helper tests. The 70/30 creator split is the single source of truth for the creator/payout
// surfaces, so it is unit-tested: the split is exact (creator + platform === gross, no rounding leak),
// floors fractional sub-units to the platform, and normalizes invalid input. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { revenueShare, CREATOR_SHARE, PLATFORM_SHARE } from "./revenue.js";

test("70/30 split on a clean multiple of 10", () => {
  const s = revenueShare(100);
  assert.deepEqual(s, { gross: 100, creator: 70, platform: 30 });
});

test("share constants are 0.7 / 0.3 and sum to 1", () => {
  assert.equal(CREATOR_SHARE, 0.7);
  assert.equal(PLATFORM_SHARE, 0.3);
  assert.equal(CREATOR_SHARE + PLATFORM_SHARE, 1);
});

test("creator + platform always equals gross (no rounding leak) across many values", () => {
  for (let g = 0; g <= 1000; g++) {
    const s = revenueShare(g);
    assert.equal(s.creator + s.platform, g, `split must reconstruct gross at ${g}`);
    assert.equal(s.gross, g);
    // The creator share is floored, so the platform is never short-changed below its 30%.
    assert.ok(s.creator <= Math.ceil(g * 0.7));
    assert.ok(s.platform >= Math.floor(g * 0.3));
  }
});

test("fractional gross is floored before the split", () => {
  assert.deepEqual(revenueShare(99.9), { gross: 99, creator: 69, platform: 30 });
});

test("negative or non-finite gross normalizes to a zero split", () => {
  assert.deepEqual(revenueShare(-50), { gross: 0, creator: 0, platform: 0 });
  assert.deepEqual(revenueShare(Number.NaN), { gross: 0, creator: 0, platform: 0 });
  assert.deepEqual(revenueShare(Number.POSITIVE_INFINITY), { gross: 0, creator: 0, platform: 0 });
});

test("a small gross floors the creator sub-unit to the platform", () => {
  // 7 * 0.7 = 4.9 -> creator floored to 4, platform gets the remainder 3.
  assert.deepEqual(revenueShare(7), { gross: 7, creator: 4, platform: 3 });
});
