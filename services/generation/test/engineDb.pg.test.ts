// Prompt 26 PG adapter test: apply the REAL additive SQL (scripts/sql/26_generation_engine.sql) to PGlite and
// round-trip every table through PgEngineDb. This also validates the SQL file itself parses and applies. The
// service_role role is created first so the RLS policies in the file can be created on PGlite. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type pg from "pg";
import { PgEngineDb } from "../src/engineDb.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.resolve(here, "..", "..", "..", "scripts", "sql", "26_generation_engine.sql");

async function freshEngineDb(): Promise<{ db: PgEngineDb; raw: PGlite }> {
  const raw = await PGlite.create();
  // PGlite has no service_role role; create it so the RLS policies in the additive file can be created.
  await raw.exec("create role service_role;");
  await raw.exec(await readFile(sqlFile, "utf8"));
  const q = { query: (text: string, params?: unknown[]) => raw.query(text, params as unknown[]) } as unknown as Pick<pg.Pool, "query">;
  return { db: new PgEngineDb(q), raw };
}

const SERIES = "11111111-1111-1111-1111-111111111111";

test("the additive SQL applies and the three tables exist in mobile", async () => {
  const { raw } = await freshEngineDb();
  const r = await raw.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'mobile' order by table_name",
  );
  const names = r.rows.map((x) => x.table_name);
  for (const t of ["generation_attempts", "qa_scores", "reference_embeddings"]) {
    assert.ok(names.includes(t), `missing mobile.${t}`);
  }
});

test("reference embeddings round-trip (and a face vector persists)", async () => {
  const { db } = await freshEngineDb();
  await db.insertReferenceEmbedding({ series_id: SERIES, owner_type: "character", owner_ref: "hero", kind: "face", embedding: [0.1, 0.2, 0.3], model: "arcface-r100", dim: 3 });
  await db.insertReferenceEmbedding({ series_id: SERIES, owner_type: "scene", owner_ref: "alley", kind: "scene", embedding: [0.4, 0.5], model: "viclip-b16", dim: 2 });

  const faces = await db.getReferenceEmbeddings(SERIES, "character", "hero");
  assert.equal(faces.length, 1);
  assert.deepEqual(faces[0].embedding, [0.1, 0.2, 0.3]);
  assert.equal(faces[0].model, "arcface-r100");

  const scenes = await db.getReferenceEmbeddings(SERIES, "scene", "alley");
  assert.equal(scenes.length, 1);
  assert.deepEqual(scenes[0].embedding, [0.4, 0.5]);
});

test("attempts + qa_scores round-trip and list by spec in order", async () => {
  const { db } = await freshEngineDb();
  const a1 = await db.insertAttempt({ spec_id: "spec-A", beat_id: null, attempt: 1, provider: "runway", model_handle: "runway-multishot", model_id: "gen4", output_url: null, passed: false, reason: "face_below_threshold", cost_usd: 0.25, cached: false, state: "done" });
  await db.insertQaScore({ generation_attempt_id: a1.id, beat_variant_id: null, face_cosine: 0.2, scene_score: 0.9, thresholds: { faceCosineMin: 0.5, sceneScoreMin: 0.5 }, passed: false, reasons: ["face_below_threshold"] });
  await db.insertAttempt({ spec_id: "spec-A", beat_id: null, attempt: 2, provider: "fal", model_handle: "fal-basic-final", model_id: "fal-basic", output_url: "https://cdn/x.mp4", passed: true, reason: "ok", cost_usd: 0.25, cached: false, state: "done" });

  const attempts = await db.listAttempts("spec-A");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attempt, 1);
  assert.equal(attempts[0].passed, false);
  assert.equal(attempts[1].attempt, 2);
  assert.equal(attempts[1].passed, true);
  assert.equal(attempts[1].provider, "fal");
});
