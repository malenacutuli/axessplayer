// QA gate unit tests. The gate asserts structural / policy properties of a produced row and its manifest,
// not AI output quality. A passed result means servable; a rejected result means it never serves. No em
// dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runQaCheck, isServable } from "../src/qa.js";
import { buildManifest } from "../src/c2pa.js";
import type { VariantRow } from "../src/spec.js";
import type { MediaArtifact } from "../src/backends.js";

const NOW = () => new Date("2026-06-15T00:00:00.000Z");

function artifact(): MediaArtifact {
  return {
    playback_url: "https://cdn.example/gen/abc/dubbing.es.i3.m3u8",
    duration_ms: 42000,
    content_hash: "sha256:deadbeef",
    steps: ["decode", "dubbing_synthesize", "encode_hls"],
    generator: "fake-dubbing-v0",
  };
}

function goodRow(): VariantRow {
  return {
    id: "cccccccc-0000-0000-0000-0000000000aa",
    beat_id: "bbbbbbbb-0000-0000-0000-000000000002",
    language: "es",
    accessibility: {},
    intensity: 3,
    pov: null,
    tier: "A_filmed",
    is_premium: false,
    coin_cost: 0,
    playback_url: artifact().playback_url,
    duration_ms: 42000,
    provenance_id: null,
    qa_status: "pending",
    placement_slots: [],
  };
}

function manifestFor(row: VariantRow) {
  return buildManifest({
    beatVariantId: row.id,
    tier: row.tier,
    kind: "dubbing",
    artifact: artifact(),
    source_url: "https://cdn.example/spine/x.mov",
    now: NOW,
  });
}

test("a well-formed row + matching manifest passes", () => {
  const row = goodRow();
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "passed");
  assert.deepEqual(res.reasons, []);
  assert.equal(isServable(res.status), true);
});

test("missing playback_url is rejected", () => {
  const row = { ...goodRow(), playback_url: "" };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("missing_playback_url"));
});

test("premium without a price is rejected", () => {
  const row = { ...goodRow(), is_premium: true, coin_cost: 0 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("premium_without_price"));
});

test("a price without premium is rejected", () => {
  const row = { ...goodRow(), is_premium: false, coin_cost: 5 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("priced_without_premium"));
});

test("a negative coin_cost is rejected", () => {
  const row = { ...goodRow(), coin_cost: -3 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("invalid_coin_cost"));
});

test("an out-of-range intensity is rejected", () => {
  const row = { ...goodRow(), intensity: 7 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("intensity_out_of_range"));
});

test("a manifest bound to a different row is rejected", () => {
  const row = goodRow();
  const wrong = manifestFor({ ...row, id: "cccccccc-0000-0000-0000-0000000000bb" });
  const res = runQaCheck({ row, manifest: wrong });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("manifest_row_mismatch"));
});

test("a non-positive duration is rejected", () => {
  const row = { ...goodRow(), duration_ms: 0 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.includes("invalid_duration"));
});

test("a valid premium variant with a price passes", () => {
  const row = { ...goodRow(), is_premium: true, coin_cost: 5 };
  const res = runQaCheck({ row, manifest: manifestFor(row) });
  assert.equal(res.status, "passed");
});
