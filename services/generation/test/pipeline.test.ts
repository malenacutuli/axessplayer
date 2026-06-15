// Pipeline-step unit tests over PGlite with a FAKE media backend. Real GPU / model / media calls are
// MOCKED behind the cost gate; these tests assert ROW SHAPES and QA GATING, not AI output quality.
// Proves: a (beat + spec) produces schema-valid beat_variants rows; the cost gate blocks a real-cost
// backend by default; each variant kind sets the right columns; every row lands qa_status = pending then
// promotes; rejected rows never become servable; planning rejects bad specs before any media call; the
// batch worker isolates per-spec failures. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshDb,
  pgliteGenerationDb,
  beatRefFromFixture,
  rawVariant,
  FIX,
} from "./harness.js";
import {
  runPipeline,
  runBatch,
  planVariant,
  PipelineError,
  type ProducedVariant,
} from "../src/pipeline.js";
import {
  FakeMediaBackend,
  UnimplementedRealMediaBackend,
  assertCostGate,
  CostGateError,
} from "../src/backends.js";
import { isServable } from "../src/qa.js";
import { QA_STATUSES, VARIANT_TIERS } from "../src/spec.js";
import type { GenerationSpec } from "../src/spec.js";

const FIXED_NOW = () => new Date("2026-06-15T00:00:00.000Z");

function spec(overrides: Partial<GenerationSpec> = {}): GenerationSpec {
  return {
    spec_id: "spec-001",
    beat: beatRefFromFixture(FIX.beatBranchPoint),
    variants: [
      { kind: "dubbing", tier: "A_filmed", language: "es" },
      { kind: "captions", tier: "A_filmed", language: "es" },
    ],
    ...overrides,
  };
}

// ---------- cost gate ----------

test("cost gate blocks a real-cost backend by default", () => {
  const real = new UnimplementedRealMediaBackend();
  assert.throws(() => assertCostGate(real), CostGateError);
});

test("cost gate allows a real-cost backend only when explicitly opened", () => {
  const real = new UnimplementedRealMediaBackend();
  assert.doesNotThrow(() => assertCostGate(real, { allowRealSpend: true }));
});

test("cost gate always allows the fake (zero-cost) backend", () => {
  assert.doesNotThrow(() => assertCostGate(new FakeMediaBackend()));
});

test("runPipeline aborts on a real-cost backend before any media call", async () => {
  const db = pgliteGenerationDb(await freshDb());
  await assert.rejects(
    runPipeline(spec(), { db, media: new UnimplementedRealMediaBackend() }),
    CostGateError
  );
});

// ---------- row shapes + QA gating ----------

test("a (beat + spec) produces schema-valid rows that promote past the QA gate", async () => {
  const pg = await freshDb();
  const db = pgliteGenerationDb(pg);
  const res = await runPipeline(spec(), { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });

  assert.equal(res.spec_id, "spec-001");
  assert.equal(res.beat_id, FIX.beatBranchPoint);
  assert.equal(res.produced.length, 2);
  assert.equal(res.passed, 2);
  assert.equal(res.rejected, 0);

  for (const p of res.produced) {
    // qa_status is a known enum and the gate promoted it to passed (servable).
    assert.ok(QA_STATUSES.includes(p.row.qa_status));
    assert.equal(p.row.qa_status, "passed");
    assert.ok(isServable(p.row.qa_status));
    // row carries a real playable url and a positive duration.
    assert.ok(p.row.playback_url.length > 0);
    assert.ok((p.row.duration_ms ?? 0) > 0);
    // tier is a known enum, coin_cost is a non-negative integer.
    assert.ok(VARIANT_TIERS.includes(p.row.tier));
    assert.ok(Number.isInteger(p.row.coin_cost) && p.row.coin_cost >= 0);
    // the row persisted in Postgres with the promoted status.
    const raw = await rawVariant(pg, p.row.id);
    assert.ok(raw);
    assert.equal(raw.qa_status, "passed");
    assert.equal(raw.beat_id, FIX.beatBranchPoint);
  }
});

test("every variant lands pending out of the pipeline before the gate promotes it", async () => {
  // Stub the DB so we can observe the exact qa_status the pipeline inserts.
  const pg = await freshDb();
  const realDb = pgliteGenerationDb(pg);
  const insertedStatuses: string[] = [];
  const spyDb = {
    ...realDb,
    insertVariant: async (row: any) => {
      insertedStatuses.push(row.qa_status);
      return realDb.insertVariant(row);
    },
  };
  await runPipeline(spec(), { db: spyDb, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  assert.deepEqual(insertedStatuses, ["pending", "pending"]);
});

test("a rejected variant never becomes servable", async () => {
  const pg = await freshDb();
  const db = pgliteGenerationDb(pg);
  // is_premium with coin_cost 0 fails the QA gate (premium_without_price).
  const bad = spec({
    variants: [{ kind: "intensity", tier: "C_ai", intensity: 5, is_premium: true, coin_cost: 0 }],
  });
  const res = await runPipeline(bad, { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  assert.equal(res.produced.length, 1);
  const p = res.produced[0];
  assert.equal(p.qa.status, "rejected");
  assert.ok(p.qa.reasons.includes("premium_without_price"));
  assert.equal(p.row.qa_status, "rejected");
  assert.equal(isServable(p.row.qa_status), false);
  // persisted as rejected, never passed.
  const raw = await rawVariant(pg, p.row.id);
  assert.equal(raw!.qa_status, "rejected");
});

// ---------- variant kinds set the right columns ----------

test("each variant kind sets its accessibility / language / intensity / pov columns", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const kindsSpec = spec({
    spec_id: "kinds",
    variants: [
      { kind: "dubbing", tier: "A_filmed", language: "fr" },
      { kind: "captions", tier: "A_filmed", language: "fr" },
      { kind: "audio_description", tier: "A_filmed", language: "en" },
      { kind: "sign", tier: "A_filmed", language: "en", accessibility: { sign: "bsl" } },
      { kind: "intensity", tier: "B_likeness", intensity: 1 },
      { kind: "pov", tier: "C_ai", pov: "antagonist" },
    ],
  });
  const res = await runPipeline(kindsSpec, { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  const byKind = (i: number): ProducedVariant => res.produced[i];

  assert.equal(byKind(0).row.language, "fr"); // dubbing
  assert.equal(byKind(1).row.accessibility.captions, true); // captions
  assert.equal(byKind(2).row.accessibility.audio_description, true); // audio description
  assert.equal(byKind(3).row.accessibility.sign, "bsl"); // sign locale honored
  assert.equal(byKind(4).row.intensity, 1); // intensity recut
  assert.equal(byKind(4).row.tier, "B_likeness");
  assert.equal(byKind(5).row.pov, "antagonist"); // pov recut
  assert.equal(byKind(5).row.tier, "C_ai");
  // all six passed.
  assert.equal(res.passed, 6);
});

test("sign kind defaults the sign locale to ase when unspecified", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const res = await runPipeline(
    spec({ variants: [{ kind: "sign", tier: "A_filmed" }] }),
    { db, media: new FakeMediaBackend() },
    { now: FIXED_NOW }
  );
  assert.equal(res.produced[0].row.accessibility.sign, "ase");
});

// ---------- planning validation (fails before any media call) ----------

test("planVariant rejects an out-of-range intensity", () => {
  assert.throws(
    () => planVariant(beatRefFromFixture(FIX.beatBranchPoint), { kind: "intensity", tier: "A_filmed", intensity: 9 }),
    PipelineError
  );
});

test("planVariant rejects a negative coin_cost", () => {
  assert.throws(
    () => planVariant(beatRefFromFixture(FIX.beatBranchPoint), { kind: "dubbing", tier: "A_filmed", coin_cost: -1 }),
    PipelineError
  );
});

test("runPipeline rejects an unknown beat id", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const bad = spec({ beat: beatRefFromFixture("ffffffff-0000-0000-0000-000000000000") });
  await assert.rejects(runPipeline(bad, { db, media: new FakeMediaBackend() }), PipelineError);
});

test("runPipeline rejects a series mismatch against the resolved beat", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const bad = spec({
    beat: beatRefFromFixture(FIX.beatBranchPoint, "00000000-0000-0000-0000-000000000000"),
  });
  await assert.rejects(runPipeline(bad, { db, media: new FakeMediaBackend() }), PipelineError);
});

// ---------- batch worker ----------

test("runBatch isolates a failing spec and still runs the rest", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const good = spec({ spec_id: "good" });
  const bad = spec({ spec_id: "bad", beat: beatRefFromFixture("ffffffff-0000-0000-0000-000000000000") });
  const out = await runBatch([good, bad], { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  assert.equal(out.length, 2);
  const goodItem = out.find((o) => o.spec_id === "good")!;
  const badItem = out.find((o) => o.spec_id === "bad")!;
  assert.equal(goodItem.ok, true);
  assert.equal(goodItem.result!.passed, 2);
  assert.equal(badItem.ok, false);
  assert.ok(badItem.error);
});

test("the fake backend is deterministic: same spec yields the same media url", async () => {
  const db = pgliteGenerationDb(await freshDb());
  const a = await runPipeline(spec(), { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  const b = await runPipeline(spec(), { db, media: new FakeMediaBackend() }, { now: FIXED_NOW });
  assert.equal(a.produced[0].row.playback_url, b.produced[0].row.playback_url);
});
