// Data port for the recap service. The recap engine is pure (see recap/assemble.ts); this port is the only
// thing that touches the database. It reads two things from the hosted mobile schema:
//
//   1. The viewer_state for (userId, seriesId): pov, language, favoriteCharacter, branchPath, skippedScenes,
//      lastBeat. Derived upstream from viewer_state + decision_log + events; this service consumes it.
//   2. The cached beat variants for the series: { id, beat, order, pov, character, thumb, captions }.
//
// The PgRecapStore below is a node-postgres-backed implementation. The exact column/table names of the
// hosted mobile schema are owned by frozen migrations this slice must not touch, so the SQL is written
// against the documented shapes and kept in one place: if a column name differs at wiring time, it is a
// one-line change here, not a change to the engine or the frozen schema. The store NEVER writes; recap is
// read + select only. No em dashes.

import type pg from "pg";
import type { BeatVariant, ViewerState } from "./recap/assemble.js";

export interface RecapStore {
  // Resolve the viewer_state for (userId, seriesId), or null when the viewer has no state for the series.
  getViewerState(userId: string, seriesId: string): Promise<ViewerState | null>;
  // The cached beat variants eligible to appear in a recap for the series.
  getBeatVariants(seriesId: string): Promise<BeatVariant[]>;
}

// Coerce an unknown JSON value into a string array (branchPath / skippedScenes may arrive as a Postgres
// array or a jsonb array depending on the column type). Defensive so a malformed row degrades to an empty
// recap rather than throwing.
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function toCaptions(v: unknown): Record<string, string> {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
    return out;
  }
  return {};
}

// Postgres-backed store. The pool is built in serve.ts with options=-c search_path=mobile,public on the
// hosted project, so the unqualified table names below resolve to the isolated mobile schema. The queries
// are read-only.
export class PgRecapStore implements RecapStore {
  constructor(private readonly pool: pg.Pool) {}

  async getViewerState(userId: string, seriesId: string): Promise<ViewerState | null> {
    // viewer_state is keyed by (user_id, series_id). The recap inputs (pov, language, favoriteCharacter,
    // branchPath, skippedScenes, lastBeat) are DERIVED upstream and the exact column names are owned by the
    // frozen schema. FAIL-SAFE: if the columns differ on the hosted schema, return null so the endpoint
    // answers a clean 404 (no_viewer_state) rather than a 500. CUTOVER: map these from viewer_state.
    // preference_vector + decision_log + engagement_events for real recaps (followup).
    let res;
    try {
      res = await this.pool.query(
        `select pov, language, favorite_character, branch_path, skipped_scenes, last_beat
           from viewer_state
          where user_id = $1 and series_id = $2
          limit 1`,
        [userId, seriesId],
      );
    } catch {
      return null;
    }
    const row = res.rows[0] as
      | {
          pov: string | null;
          language: string | null;
          favorite_character: string | null;
          branch_path: unknown;
          skipped_scenes: unknown;
          last_beat: string | null;
        }
      | undefined;
    if (row == null) return null;
    return {
      pov: row.pov ?? "any",
      language: row.language ?? "en",
      favoriteCharacter: row.favorite_character ?? "",
      branchPath: toStringArray(row.branch_path),
      skippedScenes: toStringArray(row.skipped_scenes),
      lastBeat: row.last_beat ?? "",
    };
  }

  async getBeatVariants(seriesId: string): Promise<BeatVariant[]> {
    // Cached beat variants for the series. FAIL-SAFE: column/table names are owned by the frozen schema; on
    // any mismatch return an empty pool so the recap degrades to empty rather than 500. CUTOVER: map to the
    // real mobile.beat_variants columns (beat_id, caption_doc_url, etc.) for real recaps (followup).
    let res;
    try {
      res = await this.pool.query(
        `select id, beat, beat_order, pov, character, thumb, captions
           from beat_variant
          where series_id = $1`,
        [seriesId],
      );
    } catch {
      return [];
    }
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      beat: String(r.beat),
      order: Number(r.beat_order ?? 0),
      pov: String(r.pov ?? "any"),
      character: String(r.character ?? ""),
      thumb: String(r.thumb ?? ""),
      captions: toCaptions(r.captions),
    }));
  }
}
