// Fast integration harness for the generation pipeline over PGlite (real Postgres compiled to wasm, with
// plpgsql). Applies the same files supabase db reset applies: every supabase/migrations/*.sql in lexical
// order, then supabase/seed.sql. The seed builds the walking-skeleton series, so a pipeline run operates on
// a real seeded beat and writes real beat_variants rows the schema validates. The GenerationDB adapter
// here is the same shape as the production node-postgres adapter and shares mapVariant. No em dashes.

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { GenerationDB, BeatRecord } from "../src/generationDb.js";
import { mapVariant } from "../src/generationDb.js";
import type { VariantRowInsert, VariantRow, QaStatus } from "../src/spec.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// test -> generation -> services -> repo root
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

// Fixture ids from supabase/seed.sql, named so the assertions read like the contract.
export const FIX = {
  series: "11111111-1111-1111-1111-111111111111",
  episode: "22222222-2222-2222-2222-222222222222",
  beatColdOpen: "bbbbbbbb-0000-0000-0000-000000000001",
  beatBranchPoint: "bbbbbbbb-0000-0000-0000-000000000002",
  beatCalm: "bbbbbbbb-0000-0000-0000-00000000000a",
  beatTense: "bbbbbbbb-0000-0000-0000-00000000000b",
  beatEnding: "bbbbbbbb-0000-0000-0000-000000000004",
} as const;

export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);
  for (const f of files) {
    await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
  }
  await db.exec(await readFile(seedFile, "utf8"));
  return db;
}

// PGlite-backed GenerationDB. Same shape as PgGenerationDb over node-postgres.
export function pgliteGenerationDb(db: PGlite): GenerationDB {
  return {
    async getBeat(id: string): Promise<BeatRecord | null> {
      const r = await db.query<Record<string, unknown>>(
        "select id, series_id, episode_id, role from beats where id = $1",
        [id]
      );
      const row = r.rows[0];
      return row
        ? {
            id: row.id as string,
            series_id: row.series_id as string,
            episode_id: row.episode_id as string,
            role: row.role as BeatRecord["role"],
          }
        : null;
    },
    async insertVariant(row: VariantRowInsert): Promise<VariantRow> {
      const r = await db.query<Record<string, unknown>>(
        `insert into beat_variants
           (beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
            playback_url, duration_ms, qa_status, placement_slots)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
                   playback_url, duration_ms, provenance_id, qa_status, placement_slots`,
        [
          row.beat_id,
          row.language,
          row.accessibility,
          row.intensity,
          row.pov,
          row.tier,
          row.is_premium,
          row.coin_cost,
          row.playback_url,
          row.duration_ms,
          row.qa_status,
          JSON.stringify(row.placement_slots),
        ]
      );
      return mapVariant(r.rows[0]);
    },
    async setQaStatus(
      variantId: string,
      status: Exclude<QaStatus, "pending">
    ): Promise<VariantRow | null> {
      const r = await db.query<Record<string, unknown>>(
        `update beat_variants set qa_status = $2
         where id = $1 and qa_status = 'pending'
         returning id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
                   playback_url, duration_ms, provenance_id, qa_status, placement_slots`,
        [variantId, status]
      );
      return r.rows[0] ? mapVariant(r.rows[0]) : null;
    },
    async listPassedVariantsForBeat(beatId: string): Promise<VariantRow[]> {
      const r = await db.query<Record<string, unknown>>(
        `select id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
                playback_url, duration_ms, provenance_id, qa_status, placement_slots
         from beat_variants where beat_id = $1 and qa_status = 'passed' order by id`,
        [beatId]
      );
      return r.rows.map(mapVariant);
    },
  };
}

// Read a raw variant row straight from the DB (bypassing the adapter) so a test can assert the persisted
// shape, not just the value the adapter returned.
export async function rawVariant(db: PGlite, id: string): Promise<Record<string, unknown> | null> {
  const r = await db.query<Record<string, unknown>>(
    "select * from beat_variants where id = $1",
    [id]
  );
  return r.rows[0] ?? null;
}

// A BeatRef the pipeline accepts, built from a seeded beat id with placeholder source media.
export function beatRefFromFixture(
  beatId: string,
  seriesId: string = FIX.series,
  episodeId: string = FIX.episode
) {
  return {
    id: beatId,
    series_id: seriesId,
    episode_id: episodeId,
    role: "variant" as const,
    source_url: "https://cdn.example/spine/" + beatId + ".mov",
    duration_ms: 42000,
  };
}
