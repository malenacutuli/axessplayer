// Production ContentDB over node-postgres. The handlers depend only on the ContentDB interface; this is
// the real adapter. It reads and writes the content tables it owns at runtime (series, episodes, beats,
// beat_variants, beat_edges). It never alters the frozen schema. The graph read assembles episodes,
// beats, variants, and edges in one pass per table and stitches them in memory, ordered the way the
// player and decision engine expect (episode_number, then beat_index). No em dashes.

import type pg from "pg";
import type {
  ContentDB,
  SeriesRow,
  EpisodeRow,
  BeatRow,
  VariantRow,
  EdgeRow,
  SeriesGraph,
  GraphEpisode,
  GraphBeat,
  BeatRole,
  VariantTier,
  QaStatus,
  FeedItem,
  VariantTracks,
} from "./content.js";

type Q = Pick<pg.Pool, "query">;

export class PgContentDb implements ContentDB {
  constructor(private readonly db: Q) {}

  async insertSeries(row: Omit<SeriesRow, "id">): Promise<SeriesRow> {
    const r = await this.db.query(
      `insert into public.series (title, genre, base_language, available_languages, cover_url)
       values ($1, $2, $3, $4, $5)
       returning id, title, genre, base_language, available_languages, cover_url`,
      [row.title, row.genre, row.base_language, row.available_languages, row.cover_url]
    );
    return mapSeries(r.rows[0]);
  }

  async getEpisode(id: string): Promise<{ id: string; series_id: string } | null> {
    const r = await this.db.query("select id, series_id from public.episodes where id = $1", [id]);
    return r.rows[0] ? { id: r.rows[0].id, series_id: r.rows[0].series_id } : null;
  }

  async getBeat(id: string): Promise<{ id: string; series_id: string; episode_id: string } | null> {
    const r = await this.db.query(
      "select id, series_id, episode_id from public.beats where id = $1",
      [id]
    );
    return r.rows[0]
      ? { id: r.rows[0].id, series_id: r.rows[0].series_id, episode_id: r.rows[0].episode_id }
      : null;
  }

  async seriesExists(id: string): Promise<boolean> {
    const r = await this.db.query("select 1 from public.series where id = $1", [id]);
    return r.rows.length > 0;
  }

  async insertEpisode(row: Omit<EpisodeRow, "id">): Promise<EpisodeRow> {
    const r = await this.db.query(
      `insert into public.episodes (series_id, episode_number, title, is_free, coin_cost)
       values ($1, $2, $3, $4, $5)
       returning id, series_id, episode_number, title, is_free, coin_cost`,
      [row.series_id, row.episode_number, row.title, row.is_free, row.coin_cost]
    );
    return mapEpisode(r.rows[0]);
  }

  async insertBeat(row: Omit<BeatRow, "id">): Promise<BeatRow> {
    const r = await this.db.query(
      `insert into public.beats (series_id, episode_id, beat_index, role, canon_facts, is_branch_point)
       values ($1, $2, $3, $4, $5, $6)
       returning id, series_id, episode_id, beat_index, role, canon_facts, is_branch_point`,
      [row.series_id, row.episode_id, row.beat_index, row.role, row.canon_facts, row.is_branch_point]
    );
    return mapBeat(r.rows[0]);
  }

  async insertVariant(row: Omit<VariantRow, "id">): Promise<VariantRow> {
    const r = await this.db.query(
      `insert into public.beat_variants
         (beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
          playback_url, duration_ms, provenance_id, qa_status, placement_slots)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        row.provenance_id,
        row.qa_status,
        JSON.stringify(row.placement_slots),
      ]
    );
    return mapVariant(r.rows[0]);
  }

  async deleteVariant(id: string): Promise<boolean> {
    const r = await this.db.query(
      "delete from public.beat_variants where id = $1 returning id",
      [id]
    );
    return r.rows.length > 0;
  }

  async setVariantTracks(id: string, tracks: VariantTracks): Promise<VariantRow | null> {
    // coalesce leaves a column unchanged when its param is null, so only provided tracks are written.
    const r = await this.db.query(
      `update public.beat_variants set
         caption_doc_url       = coalesce($2, caption_doc_url),
         audio_description_url = coalesce($3, audio_description_url),
         sign_video_url        = coalesce($4, sign_video_url),
         dub_audio_urls        = coalesce($5, dub_audio_urls)
       where id = $1
       returning ${VARIANT_COLS}`,
      [
        id,
        tracks.caption_doc_url ?? null,
        tracks.audio_description_url ?? null,
        tracks.sign_video_url ?? null,
        tracks.dub_audio_urls ? JSON.stringify(tracks.dub_audio_urls) : null,
      ]
    );
    return r.rows[0] ? mapVariant(r.rows[0]) : null;
  }

  async setSeriesPublished(id: string, published: boolean): Promise<{ id: string; published_at: string | null } | null> {
    const r = await this.db.query(
      "update public.series set published_at = case when $2 then now() else null end where id = $1 returning id, published_at",
      [id, published]
    );
    if (r.rows.length === 0) return null;
    return { id: r.rows[0].id as string, published_at: toIso(r.rows[0].published_at) };
  }

  async listPublishedSeries(): Promise<FeedItem[]> {
    const r = await this.db.query(
      `select id, title, genre, cover_url, poster_url, base_language, available_languages, published_at
       from public.series where published_at is not null order by published_at desc, id`
    );
    return r.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      genre: (row.genre as string) ?? null,
      cover_url: (row.cover_url as string) ?? null,
      poster_url: (row.poster_url as string) ?? null,
      base_language: row.base_language as string,
      available_languages: (row.available_languages as string[]) ?? [],
      published_at: toIso(row.published_at) as string,
    }));
  }

  async setSeriesPoster(id: string, posterUrl: string, provenance: Record<string, unknown>): Promise<{ id: string; poster_url: string } | null> {
    const r = await this.db.query(
      "update public.series set poster_url = $2, poster_provenance = $3 where id = $1 returning id, poster_url",
      [id, posterUrl, JSON.stringify(provenance)]
    );
    if (r.rows.length === 0) return null;
    return { id: r.rows[0].id as string, poster_url: r.rows[0].poster_url as string };
  }

  async insertEdge(row: EdgeRow): Promise<EdgeRow> {
    const r = await this.db.query(
      `insert into public.beat_edges (from_beat_id, to_beat_id, condition)
       values ($1, $2, $3)
       returning from_beat_id, to_beat_id, condition`,
      [row.from_beat_id, row.to_beat_id, row.condition]
    );
    return mapEdge(r.rows[0]);
  }

  async getSeriesGraph(seriesId: string): Promise<SeriesGraph | null> {
    const s = await this.db.query(
      "select id, title, genre, base_language, available_languages, cover_url, published_at, poster_url, poster_provenance from public.series where id = $1",
      [seriesId]
    );
    if (s.rows.length === 0) return null;

    const eps = await this.db.query(
      `select id, episode_number, title, is_free, coin_cost
       from public.episodes where series_id = $1 order by episode_number, id`,
      [seriesId]
    );
    const beats = await this.db.query(
      `select id, episode_id, beat_index, role, is_branch_point, canon_facts
       from public.beats where series_id = $1 order by beat_index, id`,
      [seriesId]
    );
    const variants = await this.db.query(
      `select v.id, v.beat_id, v.language, v.accessibility, v.intensity, v.pov, v.tier, v.is_premium,
              v.coin_cost, v.playback_url, v.duration_ms, v.qa_status,
              v.caption_doc_url, v.audio_description_url, v.sign_video_url, v.dub_audio_urls
       from public.beat_variants v
       join public.beats b on b.id = v.beat_id
       where b.series_id = $1 order by v.id`,
      [seriesId]
    );
    const edges = await this.db.query(
      `select e.from_beat_id, e.to_beat_id, e.condition
       from public.beat_edges e
       join public.beats b on b.id = e.from_beat_id
       where b.series_id = $1 order by e.from_beat_id, e.to_beat_id`,
      [seriesId]
    );

    return assembleGraph(
      mapSeries(s.rows[0]),
      eps.rows,
      beats.rows,
      variants.rows,
      edges.rows
    );
  }
}

// ---------- row mappers (shared shapes; numbers come back as strings from pg) ----------
function mapSeries(r: Record<string, unknown>): SeriesRow {
  return {
    id: r.id as string,
    title: r.title as string,
    genre: (r.genre as string) ?? null,
    base_language: r.base_language as string,
    available_languages: (r.available_languages as string[]) ?? [],
    cover_url: (r.cover_url as string) ?? null,
    published_at: toIso(r.published_at),
    poster_url: (r.poster_url as string) ?? null,
    poster_provenance: toObj(r.poster_provenance),
  };
}
function mapEpisode(r: Record<string, unknown>): EpisodeRow {
  return {
    id: r.id as string,
    series_id: r.series_id as string,
    episode_number: Number(r.episode_number),
    title: (r.title as string) ?? null,
    is_free: Boolean(r.is_free),
    coin_cost: Number(r.coin_cost),
  };
}
function mapBeat(r: Record<string, unknown>): BeatRow {
  return {
    id: r.id as string,
    series_id: r.series_id as string,
    episode_id: r.episode_id as string,
    beat_index: Number(r.beat_index),
    role: r.role as BeatRole,
    canon_facts: (r.canon_facts as Record<string, unknown>) ?? {},
    is_branch_point: Boolean(r.is_branch_point),
  };
}
function mapVariant(r: Record<string, unknown>): VariantRow {
  return {
    id: r.id as string,
    beat_id: r.beat_id as string,
    language: r.language as string,
    accessibility: (r.accessibility as Record<string, unknown>) ?? {},
    intensity: Number(r.intensity),
    pov: (r.pov as string) ?? null,
    tier: r.tier as VariantTier,
    is_premium: Boolean(r.is_premium),
    coin_cost: Number(r.coin_cost),
    playback_url: r.playback_url as string,
    duration_ms: r.duration_ms == null ? null : Number(r.duration_ms),
    provenance_id: (r.provenance_id as string) ?? null,
    qa_status: r.qa_status as QaStatus,
    placement_slots: (r.placement_slots as unknown[]) ?? [],
    caption_doc_url: (r.caption_doc_url as string) ?? null,
    audio_description_url: (r.audio_description_url as string) ?? null,
    sign_video_url: (r.sign_video_url as string) ?? null,
    dub_audio_urls: toStrMap(r.dub_audio_urls),
  };
}

// timestamptz comes back as a Date from node-postgres and a string from PGlite; normalize to ISO or null.
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
// jsonb comes back parsed from node-postgres and may be a string from PGlite; normalize to an object or null.
function toObj(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof v === "object") return v as Record<string, unknown>;
  return null;
}
function toStrMap(v: unknown): Record<string, string> {
  const o = toObj(v);
  if (!o) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(o)) if (typeof val === "string") out[k] = val;
  return out;
}
// All beat_variant columns, for the RETURNING of inserts/updates that map back through mapVariant.
const VARIANT_COLS =
  "id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost, playback_url, " +
  "duration_ms, provenance_id, qa_status, placement_slots, caption_doc_url, audio_description_url, " +
  "sign_video_url, dub_audio_urls";
function mapEdge(r: Record<string, unknown>): EdgeRow {
  return {
    from_beat_id: r.from_beat_id as string,
    to_beat_id: r.to_beat_id as string,
    condition: (r.condition as Record<string, unknown>) ?? {},
  };
}

// Stitch the four flat result sets into the nested playable graph. Shared so the PGlite test adapter and
// this production adapter produce byte-identical graphs from the same rows.
export function assembleGraph(
  series: SeriesRow,
  epRows: Record<string, unknown>[],
  beatRows: Record<string, unknown>[],
  variantRows: Record<string, unknown>[],
  edgeRows: Record<string, unknown>[]
): SeriesGraph {
  const variantsByBeat = new Map<string, GraphBeat["variants"]>();
  for (const vr of variantRows) {
    const v = mapVariant(vr);
    const list = variantsByBeat.get(v.beat_id) ?? [];
    list.push({
      id: v.id,
      language: v.language,
      accessibility: v.accessibility,
      intensity: v.intensity,
      pov: v.pov,
      tier: v.tier,
      is_premium: v.is_premium,
      coin_cost: v.coin_cost,
      playback_url: v.playback_url,
      duration_ms: v.duration_ms,
      qa_status: v.qa_status,
      caption_doc_url: v.caption_doc_url ?? null,
      audio_description_url: v.audio_description_url ?? null,
      sign_video_url: v.sign_video_url ?? null,
      dub_audio_urls: v.dub_audio_urls ?? {},
    });
    variantsByBeat.set(v.beat_id, list);
  }

  const beatsByEpisode = new Map<string, GraphBeat[]>();
  for (const br of beatRows) {
    const b = mapBeat(br);
    const gb: GraphBeat = {
      id: b.id,
      episode_id: b.episode_id,
      beat_index: b.beat_index,
      role: b.role,
      is_branch_point: b.is_branch_point,
      canon_facts: b.canon_facts,
      variants: variantsByBeat.get(b.id) ?? [],
    };
    const list = beatsByEpisode.get(b.episode_id) ?? [];
    list.push(gb);
    beatsByEpisode.set(b.episode_id, list);
  }

  const episodes: GraphEpisode[] = epRows.map((er) => {
    const e = mapEpisode({ ...er, series_id: series.id });
    return {
      id: e.id,
      episode_number: e.episode_number,
      title: e.title,
      is_free: e.is_free,
      coin_cost: e.coin_cost,
      beats: beatsByEpisode.get(e.id) ?? [],
    };
  });

  const edges = edgeRows.map((er) => mapEdge(er));

  return { series, episodes, edges };
}
