// Unit tests for the cost-gated, vendor-stubbed performance adapters (lipsync + deage). The HARD invariant:
// an UNWIRED adapter NEVER fabricates an asset (assetUrl stays null), a cost-gated call is refused before any
// vendor work, and only a real wired vendor sets assetUrl. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runLipsync,
  runDeage,
  defaultAdapterConfig,
  type AdapterConfig,
  type PerformanceVendor,
} from "../src/adapters.js";

test("the default adapter config is UNWIRED (no vendor) so it cannot fabricate output", () => {
  const cfg = defaultAdapterConfig();
  assert.equal(cfg.vendor, null);
});

test("an UNWIRED lipsync call returns status:unwired with a NULL asset (never fabricated)", async () => {
  const cfg = defaultAdapterConfig();
  const r = await runLipsync(cfg, { identityId: "i1", language: "es-419", estimatedCost: 1 });
  assert.equal(r.status, "unwired");
  assert.equal(r.assetUrl, null);
  assert.equal(r.embedding, null);
});

test("an UNWIRED deage call returns status:unwired with a NULL asset (never fabricated)", async () => {
  const cfg = defaultAdapterConfig();
  const r = await runDeage(cfg, { identityId: "i1", targetAgeDelta: -10, estimatedCost: 1 });
  assert.equal(r.status, "unwired");
  assert.equal(r.assetUrl, null);
});

test("a cost-gated call is refused BEFORE the vendor runs", async () => {
  let called = false;
  const vendor: PerformanceVendor = {
    async lipsync() {
      called = true;
      return { assetUrl: "should-not-happen", embedding: [1, 0, 0] };
    },
    async deage() {
      called = true;
      return { assetUrl: "should-not-happen", embedding: [1, 0, 0] };
    },
  };
  const cfg: AdapterConfig = { costCeiling: 5, vendor };
  const r = await runLipsync(cfg, { identityId: "i1", language: "es-419", estimatedCost: 99 });
  assert.equal(r.status, "cost_gated");
  assert.equal(r.assetUrl, null);
  assert.equal(called, false); // vendor never reached
});

test("a WIRED vendor under the cost ceiling produces a real asset (only path that sets assetUrl)", async () => {
  const vendor: PerformanceVendor = {
    async lipsync() {
      return { assetUrl: "sovereign://dub.mp4", embedding: [1, 0, 0] };
    },
    async deage() {
      return { assetUrl: "sovereign://aged.mp4", embedding: [0, 1, 0] };
    },
  };
  const cfg: AdapterConfig = { costCeiling: 5, vendor };
  const r = await runLipsync(cfg, { identityId: "i1", language: "es-419", estimatedCost: 1 });
  assert.equal(r.status, "produced");
  assert.equal(r.assetUrl, "sovereign://dub.mp4");
  assert.deepEqual(r.embedding, [1, 0, 0]);
});
