// P10 spec test: the unified variant source resolves a pre-rendered asset directly, generates a permitted
// spec only when the FinOps budget authorizes it, denies generation under a zero/over budget, and FENCES
// the be-the-protagonist likeness tier (C9). The generator is a fake, so no real money is spent. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeSpend, estimateSpecCostUsd, DENY_ALL } from "../src/finops.js";
import { resolveVariantSource, isResolved, type GenerateFn } from "../src/variantSource.js";
import type { VariantRequest } from "../src/spec.js";

const req = (tier: string): VariantRequest => ({ tier } as unknown as VariantRequest);
const fakeGen: GenerateFn = async () => ({ playbackUrl: "https://cdn/generated.m3u8" });

describe("C16 FinOps gate", () => {
  it("denies a zero or over-budget spend and allows one within budget", () => {
    assert.equal(authorizeSpend(DENY_ALL, 1).allowed, false); // default deny-all
    assert.equal(authorizeSpend({ capUsd: 10, spentUsd: 9 }, 2).allowed, false); // over remaining
    assert.equal(authorizeSpend({ capUsd: 10, spentUsd: 0 }, 0).allowed, false); // no estimate
    const ok = authorizeSpend({ capUsd: 10, spentUsd: 0 }, 4);
    assert.equal(ok.allowed, true);
    assert.equal(ok.remainingUsd, 6);
  });
  it("estimates by shot count", () => {
    assert.ok(estimateSpecCostUsd(3) > 0);
    assert.equal(estimateSpecCostUsd(0), 0);
  });
});

describe("unified variant source", () => {
  it("passes a pre-rendered asset through without generating", async () => {
    const r = await resolveVariantSource(
      { kind: "prerendered", playbackUrl: "https://cdn/film.m3u8", tier: "A_filmed" },
      { budget: DENY_ALL, generate: fakeGen },
    );
    assert.ok(isResolved(r));
    if (isResolved(r)) {
      assert.equal(r.generated, false);
      assert.equal(r.playbackUrl, "https://cdn/film.m3u8");
    }
  });
  it("fences the be-the-protagonist likeness tier (C9), even with budget", async () => {
    const r = await resolveVariantSource(
      { kind: "spec", request: req("B_likeness"), estimatedShots: 1 },
      { budget: { capUsd: 1000, spentUsd: 0 }, generate: fakeGen },
    );
    assert.ok(!isResolved(r));
    if (!isResolved(r)) assert.equal(r.fenced, true);
  });
  it("refuses to generate a permitted spec when the FinOps budget is closed (default deny)", async () => {
    const r = await resolveVariantSource(
      { kind: "spec", request: req("C_ai"), estimatedShots: 2 },
      { budget: DENY_ALL, generate: fakeGen },
    );
    assert.ok(!isResolved(r));
    if (!isResolved(r)) assert.match(r.error, /FinOps gate denied/);
  });
  it("generates a permitted spec when the FinOps budget authorizes it", async () => {
    const r = await resolveVariantSource(
      { kind: "spec", request: req("C_ai"), estimatedShots: 2 },
      { budget: { capUsd: 100, spentUsd: 0 }, generate: fakeGen },
    );
    assert.ok(isResolved(r));
    if (isResolved(r)) {
      assert.equal(r.generated, true);
      assert.equal(r.playbackUrl, "https://cdn/generated.m3u8");
    }
  });
});
