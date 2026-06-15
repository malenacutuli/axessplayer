// A Postgres-backed ManifestDB for the acceptance gate. The manifest service ships an in-memory fixture
// DB (services/manifest/src/db.ts) and a node:http entry point (server.ts startServer(db)); it does not
// ship a Supabase/node-postgres adapter yet. This is HARNESS WIRING (not a service change): it implements
// the service's own ManifestDB port over the real Postgres so the playlist the player fetches comes from
// the same database (beat_variants, seed.sql) as every other hop. It never alters the frozen schema and
// only reads the columns the manifest handler depends on. No em dashes.

import type pg from "pg";
import type { ManifestDB, BeatVariantRow, RenditionRow } from "../../../services/manifest/src/db.js";

export class PgManifestDb implements ManifestDB {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async getVariant(variantId: string): Promise<BeatVariantRow | null> {
    const r = await this.db.query(
      `select id, beat_id, language, tier, playback_url, duration_ms
         from public.beat_variants where id = $1`,
      [variantId]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      id: row.id as string,
      beat_id: row.beat_id as string,
      language: row.language as string,
      tier: row.tier as string,
      playback_url: row.playback_url as string,
      duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    };
  }

  // The walking-skeleton seed carries one variant per beat (no stored ABR ladder), so renditions are
  // empty and the handler emits a single-rendition media playlist. The multi-rendition (master) path is
  // exercised by the manifest service's own unit tests against its fixture ladder.
  async getRenditions(_variantId: string): Promise<RenditionRow[]> {
    return [];
  }
}
