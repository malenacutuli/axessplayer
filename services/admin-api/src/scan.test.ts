// ScanProvider tests. The HARD GATE: an unwired scanner NEVER fabricates a clean/blocked verdict. The only
// legal status from the default provider is "pending_provider", for both text (harassment/abuse) and media
// (CSAM/illegal-content). No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { UnwiredScanProvider, unwiredScanProvider } from "./scan.js";

test("UnwiredScanProvider.scanText returns pending_provider, NOT a clean/blocked verdict", async () => {
  const r = await unwiredScanProvider.scanText("any text, including potentially abusive content");
  assert.equal(r.status, "pending_provider");
  // It must never claim a verdict or that it checked anything.
  assert.notEqual(r.status, "clean");
  assert.notEqual(r.status, "blocked");
  assert.deepEqual(r.categories, []);
  assert.equal(r.provider, "unwired");
  assert.ok(r.note.length > 0);
});

test("UnwiredScanProvider.scanMedia returns pending_provider, NOT a clean/blocked verdict", async () => {
  const r = await unwiredScanProvider.scanMedia("asset://some-media-ref");
  assert.equal(r.status, "pending_provider");
  assert.notEqual(r.status, "clean");
  assert.notEqual(r.status, "blocked");
  assert.deepEqual(r.categories, []);
  assert.equal(r.provider, "unwired");
});

test("a fresh UnwiredScanProvider instance behaves identically (no fabricated verdict for any input)", async () => {
  const p = new UnwiredScanProvider();
  assert.equal(p.name, "unwired");
  for (const input of ["", "clean-looking text", "harassment", "csam"]) {
    assert.equal((await p.scanText(input)).status, "pending_provider");
    assert.equal((await p.scanMedia(input)).status, "pending_provider");
  }
});
