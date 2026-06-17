// P8-T3 / C6 spec test: a counterfactual is shown as a band or a coarse win-rate, never a bare point
// number; a band straddling zero reads inconclusive; beat retention derives from engagement events.
// No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { counterfactualDisplay, winRateLabel, beatRetentionCurve } from "./presentation.js";

describe("C6 counterfactual display", () => {
  it("shows a relative uplift BAND (never a point) when the candidate clearly beats baseline", () => {
    const d = counterfactualDisplay({ lo: 0.34, hi: 0.42, estimate: 0.38 }, 0.3);
    assert.equal(d.kind, "uplift_band");
    if (d.kind === "uplift_band") {
      assert.equal(d.direction, "up");
      // it is a range, not a single number
      assert.match(d.text, /\+\d/);
      assert.match(d.text, / to /);
      assert.ok(d.hiPct > d.loPct);
    }
  });
  it("reads inconclusive when the band straddles zero (no false confidence)", () => {
    const d = counterfactualDisplay({ lo: 0.27, hi: 0.34, estimate: 0.3 }, 0.3);
    assert.equal(d.kind, "inconclusive");
  });
  it("win-rate label is coarse, never a precise probability", () => {
    assert.equal(winRateLabel({ lo: 0.34, hi: 0.42, estimate: 0.38 }, 0.3), "likely better");
    assert.equal(winRateLabel({ lo: 0.2, hi: 0.28, estimate: 0.24 }, 0.3), "likely worse");
    assert.equal(winRateLabel({ lo: 0.28, hi: 0.34, estimate: 0.31 }, 0.3), "too close to call");
  });
});

describe("beat retention curve", () => {
  it("counts reached and completed per beat from engagement events", () => {
    const events = [
      { beat_id: "b1", type: "beat_started" },
      { beat_id: "b1", type: "beat_completed" },
      { beat_id: "b1", type: "beat_started" },
      { beat_id: "b2", type: "beat_started" },
    ];
    const curve = beatRetentionCurve(events, ["b1", "b2"]);
    assert.deepEqual(curve.map((c) => c.beatId), ["b1", "b2"]);
    assert.equal(curve[0].reached, 2);
    assert.equal(curve[0].completed, 1);
    assert.equal(curve[0].completionRate, 0.5);
    assert.equal(curve[1].completionRate, 0); // reached but not completed
  });
});
