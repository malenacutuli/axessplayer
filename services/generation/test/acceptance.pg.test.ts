// Row-shape acceptance suite against a REAL Postgres server (embedded-postgres, migrations 0001..0005 +
// seed). This is the gate the brief calls out: the produced beat_variants rows must survive the frozen
// schema on a real server (composite integrity via beat_id FK, the qa_status / tier enums by value, NOT
// NULL on playback_url, non-negative coin_cost) so the content graph and manifest service can consume them.
// Real GPU / model / media calls are MOCKED behind the cost gate; this asserts ROW SHAPES + QA gating, not
// AI quality. No em dashes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startPg, type PgHandle } from "./pgharness.js";
import { PgGenerationDb } from "../src/generationDb.js";
import { runPipeline, runBatch } from "../src/pipeline.js";
import { FakeMediaBackend } from "../src/backends.js";
import { prewarmBeats, FakeCdnClient } from "../src/cdn.js";
import type { GenerationSpec } from "../src/spec.js";

const NOW = () => new Date("2026-06-15T00:00:00.000Z");

// Seeded walking-skeleton ids (supabase/seed.sql).
const FIX = {
  series: "11111111-1111-1111-1111-111111111111",
  episode: "22222222-2222-2222-2222-222222222222",
  beatBranchPoint: "bbbbbbbb-0000-0000-0000-000000000002",
} as const;

let handle: PgHandle;

before(async () => {
  handle = await startPg();
});

after(async () => {
  if (handle) await handle.stop();
});

function spec(): GenerationSpec {
  return {
    spec_id: "accept-001",
    beat: {
      id: FIX.beatBranchPoint,
      series_id: FIX.series,
      episode_id: FIX.episode,
      role: "spine",
      source_url: "https://cdn.example/spine/branch.mov",
      duration_ms: 42000,
    },
    variants: [
      { kind: "dubbing", tier: "A_filmed", language: "es" },
      { kind: "captions", tier: "A_filmed", language: "es" },
      { kind: "audio_description", tier: "A_filmed", language: "en" },
      { kind: "sign", tier: "A_filmed", language: "en", accessibility: { sign: "ase" } },
      { kind: "intensity", tier: "B_likeness", intensity: 5 },
      { kind: "pov", tier: "C_ai", pov: "antagonist", is_premium: true, coin_cost: 5 },
    ],
  };
}

test("produced rows are schema-valid on real Postgres and the content graph can read them back", async () => {
  const db = new PgGenerationDb(handle.pool);
  const res = await runPipeline(spec(), { db, media: new FakeMediaBackend() }, { now: NOW });

  assert.equal(res.produced.length, 6);
  assert.equal(res.passed, 6);
  assert.equal(res.rejected, 0);

  // Read the persisted rows straight from Postgres and assert the row shape the content graph consumes.
  const ids = res.produced.map((p) => p.row.id);
  const r = await handle.pool.query(
    `select id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
            playback_url, duration_ms, qa_status, placement_slots
     from public.beat_variants where id = any($1::uuid[]) order by id`,
    [ids]
  );
  assert.equal(r.rows.length, 6);
  for (const row of r.rows) {
    // composite integrity: every variant points at the real seeded beat (FK enforced by Postgres).
    assert.equal(row.beat_id, FIX.beatBranchPoint);
    // enums by value.
    assert.ok(["A_filmed", "B_likeness", "C_ai"].includes(row.tier));
    assert.ok(["pending", "passed", "rejected"].includes(row.qa_status));
    // NOT NULL playback_url, present and non-empty.
    assert.ok(typeof row.playback_url === "string" && row.playback_url.length > 0);
    // intensity in range, non-negative integer coin_cost.
    assert.ok(Number(row.intensity) >= 1 && Number(row.intensity) <= 5);
    assert.ok(Number.isInteger(Number(row.coin_cost)) && Number(row.coin_cost) >= 0);
    // every produced row is gated; here all promoted to passed.
    assert.equal(row.qa_status, "passed");
  }

  // The premium pov variant carries its price; the free ones do not.
  const pov = r.rows.find((x) => x.pov === "antagonist")!;
  assert.equal(Number(pov.coin_cost), 5);
  assert.equal(pov.is_premium, true);
});

test("a rejected variant persists as rejected on real Postgres and is never warmed to the CDN", async () => {
  const db = new PgGenerationDb(handle.pool);
  const bad: GenerationSpec = {
    spec_id: "accept-reject",
    beat: spec().beat,
    variants: [
      { kind: "dubbing", tier: "A_filmed", language: "de" }, // passes
      { kind: "intensity", tier: "C_ai", intensity: 4, is_premium: true, coin_cost: 0 }, // rejected
    ],
  };
  const res = await runPipeline(bad, { db, media: new FakeMediaBackend() }, { now: NOW });
  assert.equal(res.passed, 1);
  assert.equal(res.rejected, 1);

  const rejected = res.produced.find((p) => p.qa.status === "rejected")!;
  const check = await handle.pool.query("select qa_status from public.beat_variants where id = $1", [
    rejected.row.id,
  ]);
  assert.equal(check.rows[0].qa_status, "rejected");

  // Pre-warm the beat: the rejected variant must not be among the warmed targets.
  const cdn = new FakeCdnClient();
  await prewarmBeats([FIX.beatBranchPoint], db, cdn);
  assert.ok(cdn.warmed.every((t) => t.variant_id !== rejected.row.id));
  assert.ok(cdn.warmed.length > 0);
});

test("setQaStatus is a no-op once a variant has left pending (no re-promotion)", async () => {
  const db = new PgGenerationDb(handle.pool);
  const res = await runPipeline(
    { spec_id: "accept-noop", beat: spec().beat, variants: [{ kind: "dubbing", tier: "A_filmed", language: "it" }] },
    { db, media: new FakeMediaBackend() },
    { now: NOW }
  );
  const id = res.produced[0].row.id;
  // already passed; trying to reject it must not change the terminal state.
  const again = await db.setQaStatus(id, "rejected");
  assert.equal(again, null);
  const check = await handle.pool.query("select qa_status from public.beat_variants where id = $1", [id]);
  assert.equal(check.rows[0].qa_status, "passed");
});

test("the batch worker writes valid rows for many specs on real Postgres", async () => {
  const db = new PgGenerationDb(handle.pool);
  const specs: GenerationSpec[] = [
    { spec_id: "b1", beat: spec().beat, variants: [{ kind: "captions", tier: "A_filmed", language: "pt" }] },
    { spec_id: "b2", beat: spec().beat, variants: [{ kind: "dubbing", tier: "A_filmed", language: "ja" }] },
  ];
  const out = await runBatch(specs, { db, media: new FakeMediaBackend() }, { now: NOW });
  assert.ok(out.every((o) => o.ok));
  assert.equal(out.reduce((n, o) => n + (o.result?.passed ?? 0), 0), 2);
});
