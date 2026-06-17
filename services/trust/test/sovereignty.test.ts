// P7-T4 sovereign routing spec: EU/EEA and Swiss viewers keep data in an EU/Swiss region; unknown
// viewers fail-sovereign to the EU default. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dataResidencyRegion, isSovereign, SOVEREIGN_DEFAULT } from "../src/sovereignty.js";

describe("data residency routing", () => {
  it("keeps EU/EEA viewers in eu-central and Swiss viewers in ch", () => {
    assert.equal(dataResidencyRegion("DE"), "eu-central");
    assert.equal(dataResidencyRegion("fr"), "eu-central");
    assert.equal(dataResidencyRegion("NO"), "eu-central");
    assert.equal(dataResidencyRegion("CH"), "ch");
  });
  it("fails sovereign for unknown or missing country (EU default)", () => {
    assert.equal(dataResidencyRegion("US"), SOVEREIGN_DEFAULT);
    assert.equal(dataResidencyRegion(undefined), SOVEREIGN_DEFAULT);
    assert.equal(SOVEREIGN_DEFAULT, "eu-central");
  });
  it("eu-central and ch are sovereign", () => {
    assert.equal(isSovereign("eu-central"), true);
    assert.equal(isSovereign("ch"), true);
    assert.equal(isSovereign("us"), false);
  });
});
