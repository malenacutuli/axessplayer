// Data access for the generation pipeline. The pipeline depends only on the GenerationDB port. Two
// adapters implement it: the PGlite test adapter (test/harness.ts) and this production node-postgres
// adapter. The port writes beat_variants DATA rows (the frozen schema is read, never altered) and updates
// qa_status when the QA gate promotes a variant. It also reads beats so the pipeline can resolve a
// BeatRef. It never writes content_credentials: W9 owns that table and records the manifest W8 emits.
// No em dashes.

import type pg from "pg";
import type { VariantRowInsert, VariantRow, QaStatus, BeatRole } from "./spec.js";

type Q = Pick<pg.Pool, "query">;

// A beat as the pipeline needs it. Read-only.
export interface BeatRecord {
  id: string;
  series_id: string;
  episode_id: string;
  role: BeatRole;
}

export interface GenerationDB {
  // Read a beat the pipeline will operate on. Returns null if it does not exist.
  getBeat(id: string): Promise<BeatRecord | null>;
  // Insert one produced variant. Always lands qa_status from the insert row (the pipeline passes
  // "pending"). Returns the row with its assigned id.
  insertVariant(row: VariantRowInsert): Promise<VariantRow>;
  // Promote a variant after the QA gate decides. Only pending -> passed | rejected is allowed; the update
  // is a no-op (returns null) if the row is not currently pending, so a decision can never overwrite a
  // prior terminal state.
  setQaStatus(variantId: string, status: Exclude<QaStatus, "pending">): Promise<VariantRow | null>;
  // Read every servable (qa_status = passed) variant for a beat, ordered, for the CDN pre-warm pass.
  listPassedVariantsForBeat(beatId: string): Promise<VariantRow[]>;
}

export class PgGenerationDb implements GenerationDB {
  constructor(private readonly db: Q) {}

  async getBeat(id: string): Promise<BeatRecord | null> {
    const r = await this.db.query(
      "select id, series_id, episode_id, role from public.beats where id = $1",
      [id]
    );
    return r.rows[0]
      ? {
          id: r.rows[0].id,
          series_id: r.rows[0].series_id,
          episode_id: r.rows[0].episode_id,
          role: r.rows[0].role,
        }
      : null;
  }

  async insertVariant(row: VariantRowInsert): Promise<VariantRow> {
    const r = await this.db.query(
      `insert into public.beat_variants
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
  }

  async setQaStatus(
    variantId: string,
    status: Exclude<QaStatus, "pending">
  ): Promise<VariantRow | null> {
    const r = await this.db.query(
      `update public.beat_variants set qa_status = $2
       where id = $1 and qa_status = 'pending'
       returning id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
                 playback_url, duration_ms, provenance_id, qa_status, placement_slots`,
      [variantId, status]
    );
    return r.rows[0] ? mapVariant(r.rows[0]) : null;
  }

  async listPassedVariantsForBeat(beatId: string): Promise<VariantRow[]> {
    const r = await this.db.query(
      `select id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
              playback_url, duration_ms, provenance_id, qa_status, placement_slots
       from public.beat_variants
       where beat_id = $1 and qa_status = 'passed'
       order by id`,
      [beatId]
    );
    return r.rows.map(mapVariant);
  }
}

// Numbers come back from pg as strings; normalize to the row shape. Shared so both adapters agree.
export function mapVariant(r: Record<string, unknown>): VariantRow {
  return {
    id: r.id as string,
    beat_id: r.beat_id as string,
    language: r.language as string,
    accessibility: (r.accessibility as Record<string, unknown>) ?? {},
    intensity: Number(r.intensity),
    pov: (r.pov as string) ?? null,
    tier: r.tier as VariantRow["tier"],
    is_premium: Boolean(r.is_premium),
    coin_cost: Number(r.coin_cost),
    playback_url: r.playback_url as string,
    duration_ms: r.duration_ms == null ? null : Number(r.duration_ms),
    provenance_id: (r.provenance_id as string) ?? null,
    qa_status: r.qa_status as QaStatus,
    placement_slots: (r.placement_slots as unknown[]) ?? [],
  };
}
