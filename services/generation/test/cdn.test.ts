// CDN pre-warm tests. Only servable (qa_status = passed) variants are warmed before launch; a pending or
// rejected variant must never be prefetched because it must never serve. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, pgliteGenerationDb, beatRefFromFixture, FIX } from "./harness.js";
import { runPipeline } from "../src/pipeline.js";
import { FakeMediaBackend } from "../src/backends.js";
import { prewarmBeats, prewarmRows, FakeCdnClient } from "../src/cdn.js";
import type { GenerationSpec, VariantRow } from "../src/spec.js";

const NOW = () => new Date("2026-06-15T00:00:00.000Z");

function mixedSpec(): GenerationSpec {
  return {
    spec_id: "warm",
    beat: beatRefFromFixture(FIX.beatBranchPoint),
    variants: [
      { kind: "dubbing", tier: "A_filmed", language: "es" }, // passes
      { kind: "intensity", tier: "C_ai", intensity: 5, is_premium: true, coin_cost: 0 }, // rejected
    ],
  };
}

test("prewarmBeats warms only the passed variants for a beat", async () => {
  const db = pgliteGenerationDb(await freshDb());
  await runPipeline(mixedSpec(), { db, media: new FakeMediaBackend() }, { now: NOW });
  const cdn = new FakeCdnClient();
  const res = await prewarmBeats([FIX.beatBranchPoint], db, cdn);
  // exactly one passed variant warmed; the rejected one is not in the passed list.
  assert.equal(res.warmed.length, 1);
  assert.equal(cdn.warmed.length, 1);
  assert.ok(cdn.warmed[0].playback_url.length > 0);
});

test("prewarmRows skips non-servable rows defensively", async () => {
  const cdn = new FakeCdnClient();
  const rows: VariantRow[] = [
    { ...stub(), id: "a", qa_status: "passed" },
    { ...stub(), id: "b", qa_status: "pending" },
    { ...stub(), id: "c", qa_status: "rejected" },
  ];
  const res = await prewarmRows(rows, cdn);
  assert.equal(res.warmed.length, 1);
  assert.equal(res.skipped_non_servable, 2);
  assert.equal(cdn.warmed[0].variant_id, "a");
});

function stub(): VariantRow {
  return {
    id: "x",
    beat_id: FIX.beatBranchPoint,
    language: "en",
    accessibility: {},
    intensity: 3,
    pov: null,
    tier: "A_filmed",
    is_premium: false,
    coin_cost: 0,
    playback_url: "https://cdn.example/x.m3u8",
    duration_ms: 1000,
    provenance_id: null,
    qa_status: "passed",
    placement_slots: [],
  };
}
