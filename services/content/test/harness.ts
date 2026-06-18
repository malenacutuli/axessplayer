// Integration harness for the content service. Stands up an in-process Postgres (PGlite, real Postgres
// compiled to wasm, with plpgsql) and applies the same files supabase db reset applies: every
// supabase/migrations/*.sql in lexical order, then supabase/seed.sql. The seed builds the walking-skeleton
// series, so the graph assertions compare against real fixtures, not handcrafted JSON. No live service
// needed. No em dashes.

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  ContentDB,
  SeriesRow,
  UpdateSeriesBody,
  EpisodeRow,
  BeatRow,
  VariantRow,
  EdgeRow,
  SeriesGraph,
  FeedItem,
  VariantTracks,
} from "../src/content.js";
import { assembleGraph } from "../src/pgContentDb.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// test -> content -> services -> repo root
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
  variantEnding: "cccccccc-0000-0000-0000-000000000004",
  variantPremiumEnding: "cccccccc-0000-0000-0000-000000000005",
} as const;

// Spin up a fresh database with migrations + seed applied. Each call is fully isolated.
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

// Spin up a fresh database with ONLY migrations, no seed (for building the graph through the create
// endpoints from empty).
export async function emptyDb(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);
  for (const f of files) {
    await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
  }
  return db;
}

// PGlite-backed ContentDB. The production adapter (pgContentDb.ts) is the same shape over node-postgres
// and shares assembleGraph, so both produce identical graphs from identical rows.
export function pgliteContentDb(db: PGlite): ContentDB {
  return {
    async insertSeries(row: Omit<SeriesRow, "id">): Promise<SeriesRow> {
      const r = await db.query<SeriesRow>(
        `insert into series (title, genre, base_language, available_languages, cover_url)
         values ($1,$2,$3,$4,$5)
         returning id, title, genre, base_language, available_languages, cover_url`,
        [row.title, row.genre, row.base_language, row.available_languages, row.cover_url]
      );
      const out = r.rows[0];
      return { ...out, genre: out.genre ?? null, cover_url: out.cover_url ?? null, available_languages: out.available_languages ?? [] };
    },
    async getEpisode(id: string) {
      const r = await db.query<{ id: string; series_id: string }>(
        "select id, series_id from episodes where id = $1",
        [id]
      );
      return r.rows[0] ?? null;
    },
    async getBeat(id: string) {
      const r = await db.query<{ id: string; series_id: string; episode_id: string }>(
        "select id, series_id, episode_id from beats where id = $1",
        [id]
      );
      return r.rows[0] ?? null;
    },
    async seriesExists(id: string) {
      const r = await db.query("select 1 from series where id = $1", [id]);
      return r.rows.length > 0;
    },
    async insertEpisode(row: Omit<EpisodeRow, "id">): Promise<EpisodeRow> {
      const r = await db.query<EpisodeRow>(
        `insert into episodes (series_id, episode_number, title, is_free, coin_cost)
         values ($1,$2,$3,$4,$5)
         returning id, series_id, episode_number, title, is_free, coin_cost`,
        [row.series_id, row.episode_number, row.title, row.is_free, row.coin_cost]
      );
      const out = r.rows[0];
      return { ...out, episode_number: Number(out.episode_number), coin_cost: Number(out.coin_cost), title: out.title ?? null, is_free: Boolean(out.is_free) };
    },
    async insertBeat(row: Omit<BeatRow, "id">): Promise<BeatRow> {
      const r = await db.query<BeatRow>(
        `insert into beats (series_id, episode_id, beat_index, role, canon_facts, is_branch_point)
         values ($1,$2,$3,$4,$5,$6)
         returning id, series_id, episode_id, beat_index, role, canon_facts, is_branch_point`,
        [row.series_id, row.episode_id, row.beat_index, row.role, row.canon_facts, row.is_branch_point]
      );
      const out = r.rows[0];
      return { ...out, beat_index: Number(out.beat_index), canon_facts: out.canon_facts ?? {}, is_branch_point: Boolean(out.is_branch_point) };
    },
    async insertVariant(row: Omit<VariantRow, "id">): Promise<VariantRow> {
      const r = await db.query<VariantRow>(
        `insert into beat_variants
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
      const out = r.rows[0];
      return {
        ...out,
        intensity: Number(out.intensity),
        coin_cost: Number(out.coin_cost),
        is_premium: Boolean(out.is_premium),
        duration_ms: out.duration_ms == null ? null : Number(out.duration_ms),
        accessibility: out.accessibility ?? {},
        pov: out.pov ?? null,
        provenance_id: out.provenance_id ?? null,
        placement_slots: out.placement_slots ?? [],
      };
    },
    async deleteVariant(id: string): Promise<boolean> {
      const r = await db.query<{ id: string }>(
        "delete from beat_variants where id = $1 returning id",
        [id]
      );
      return r.rows.length > 0;
    },
    async insertEdge(row: EdgeRow): Promise<EdgeRow> {
      const r = await db.query<EdgeRow>(
        `insert into beat_edges (from_beat_id, to_beat_id, condition)
         values ($1,$2,$3)
         returning from_beat_id, to_beat_id, condition`,
        [row.from_beat_id, row.to_beat_id, row.condition]
      );
      const out = r.rows[0];
      return { ...out, condition: out.condition ?? {} };
    },
    async getSeriesGraph(seriesId: string): Promise<SeriesGraph | null> {
      const s = await db.query<Record<string, unknown>>(
        "select id, title, genre, base_language, available_languages, cover_url, published_at, poster_url, poster_provenance from series where id = $1",
        [seriesId]
      );
      if (s.rows.length === 0) return null;
      const eps = await db.query<Record<string, unknown>>(
        "select id, episode_number, title, is_free, coin_cost from episodes where series_id = $1 order by episode_number, id",
        [seriesId]
      );
      const beats = await db.query<Record<string, unknown>>(
        "select id, series_id, episode_id, beat_index, role, is_branch_point, canon_facts from beats where series_id = $1 order by beat_index, id",
        [seriesId]
      );
      const variants = await db.query<Record<string, unknown>>(
        `select v.id, v.beat_id, v.language, v.accessibility, v.intensity, v.pov, v.tier, v.is_premium,
                v.coin_cost, v.playback_url, v.duration_ms, v.qa_status,
                v.caption_doc_url, v.audio_description_url, v.sign_video_url, v.dub_audio_urls
         from beat_variants v join beats b on b.id = v.beat_id
         where b.series_id = $1 order by v.id`,
        [seriesId]
      );
      const edges = await db.query<Record<string, unknown>>(
        `select e.from_beat_id, e.to_beat_id, e.condition
         from beat_edges e join beats b on b.id = e.from_beat_id
         where b.series_id = $1 order by e.from_beat_id, e.to_beat_id`,
        [seriesId]
      );
      const sp = s.rows[0].poster_provenance;
      const series: SeriesRow = {
        id: s.rows[0].id as string,
        title: s.rows[0].title as string,
        genre: (s.rows[0].genre as string) ?? null,
        base_language: s.rows[0].base_language as string,
        available_languages: (s.rows[0].available_languages as string[]) ?? [],
        cover_url: (s.rows[0].cover_url as string) ?? null,
        published_at: (s.rows[0].published_at as string) ?? null,
        poster_url: (s.rows[0].poster_url as string) ?? null,
        poster_provenance: sp == null ? null : typeof sp === "string" ? JSON.parse(sp) : (sp as Record<string, unknown>),
      };
      return assembleGraph(series, eps.rows, beats.rows, variants.rows, edges.rows);
    },

    async setVariantTracks(id: string, tracks: VariantTracks): Promise<VariantRow | null> {
      const r = await db.query<Record<string, unknown>>(
        `update beat_variants set
           caption_doc_url       = coalesce($2, caption_doc_url),
           audio_description_url = coalesce($3, audio_description_url),
           sign_video_url        = coalesce($4, sign_video_url),
           dub_audio_urls        = coalesce($5, dub_audio_urls)
         where id = $1
         returning id, beat_id, language, accessibility, intensity, pov, tier, is_premium, coin_cost,
                   playback_url, duration_ms, provenance_id, qa_status, placement_slots,
                   caption_doc_url, audio_description_url, sign_video_url, dub_audio_urls`,
        [
          id,
          tracks.caption_doc_url ?? null,
          tracks.audio_description_url ?? null,
          tracks.sign_video_url ?? null,
          tracks.dub_audio_urls ? JSON.stringify(tracks.dub_audio_urls) : null,
        ]
      );
      if (r.rows.length === 0) return null;
      const out = r.rows[0];
      const dub = out.dub_audio_urls;
      return {
        ...(out as unknown as VariantRow),
        intensity: Number(out.intensity),
        coin_cost: Number(out.coin_cost),
        is_premium: Boolean(out.is_premium),
        duration_ms: out.duration_ms == null ? null : Number(out.duration_ms),
        accessibility: (out.accessibility as Record<string, unknown>) ?? {},
        pov: (out.pov as string) ?? null,
        provenance_id: (out.provenance_id as string) ?? null,
        placement_slots: (out.placement_slots as unknown[]) ?? [],
        caption_doc_url: (out.caption_doc_url as string) ?? null,
        audio_description_url: (out.audio_description_url as string) ?? null,
        sign_video_url: (out.sign_video_url as string) ?? null,
        dub_audio_urls: dub == null ? {} : typeof dub === "string" ? JSON.parse(dub) : (dub as Record<string, string>),
      };
    },

    async setSeriesPublished(id: string, published: boolean): Promise<{ id: string; published_at: string | null } | null> {
      const r = await db.query<Record<string, unknown>>(
        "update series set published_at = case when $2 then now() else null end where id = $1 returning id, published_at",
        [id, published]
      );
      if (r.rows.length === 0) return null;
      return { id: r.rows[0].id as string, published_at: (r.rows[0].published_at as string) ?? null };
    },

    async updateSeries(id: string, patch: UpdateSeriesBody): Promise<SeriesRow | null> {
      const r = await db.query<Record<string, unknown>>(
        `update series set
           title = coalesce($2, title),
           genre = coalesce($3, genre),
           base_language = coalesce($4, base_language),
           available_languages = coalesce($5, available_languages),
           cover_url = coalesce($6, cover_url)
         where id = $1
         returning id, title, genre, base_language, available_languages, cover_url`,
        [
          id,
          patch.title ?? null,
          patch.genre ?? null,
          patch.base_language ?? null,
          patch.available_languages ?? null,
          patch.cover_url ?? null,
        ]
      );
      if (r.rows.length === 0) return null;
      const out = r.rows[0];
      return {
        id: out.id as string,
        title: out.title as string,
        genre: (out.genre as string) ?? null,
        base_language: out.base_language as string,
        available_languages: (out.available_languages as string[]) ?? [],
        cover_url: (out.cover_url as string) ?? null,
      };
    },

    async listAllSeries(): Promise<SeriesRow[]> {
      const r = await db.query<Record<string, unknown>>(
        `select id, title, genre, base_language, available_languages, cover_url, published_at, poster_url
         from series order by published_at desc nulls first, id desc`
      );
      return r.rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        genre: (row.genre as string) ?? null,
        base_language: row.base_language as string,
        available_languages: (row.available_languages as string[]) ?? [],
        cover_url: (row.cover_url as string) ?? null,
        published_at: (row.published_at as string) ?? null,
        poster_url: (row.poster_url as string) ?? null,
      }));
    },

    async listPublishedSeries(): Promise<FeedItem[]> {
      const r = await db.query<Record<string, unknown>>(
        `select id, title, genre, cover_url, poster_url, base_language, available_languages, published_at
         from series where published_at is not null order by published_at desc, id`
      );
      return r.rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        genre: (row.genre as string) ?? null,
        cover_url: (row.cover_url as string) ?? null,
        poster_url: (row.poster_url as string) ?? null,
        base_language: row.base_language as string,
        available_languages: (row.available_languages as string[]) ?? [],
        published_at: row.published_at as string,
      }));
    },

    async setSeriesPoster(id: string, posterUrl: string, provenance: Record<string, unknown>): Promise<{ id: string; poster_url: string } | null> {
      const r = await db.query<Record<string, unknown>>(
        "update series set poster_url = $2, poster_provenance = $3 where id = $1 returning id, poster_url",
        [id, posterUrl, JSON.stringify(provenance)]
      );
      if (r.rows.length === 0) return null;
      return { id: r.rows[0].id as string, poster_url: r.rows[0].poster_url as string };
    },
  };
}

// Force a beat row whose series_id does not match its episode's series, bypassing the handler, to prove
// Postgres rejects it via the composite FK. Returns the error message thrown by the DB.
export async function tryInsertMismatchedBeat(db: PGlite, episodeId: string, wrongSeriesId: string): Promise<string> {
  try {
    await db.query(
      `insert into beats (series_id, episode_id, beat_index, role)
       values ($1, $2, 99, 'spine')`,
      [wrongSeriesId, episodeId]
    );
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
