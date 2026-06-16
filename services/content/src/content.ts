// Content service handlers for the content graph API, mirroring contracts/api/content.yaml 0.3.1.
// Framework-agnostic: each handler takes a validated body (or a path id) plus injected DB access. The
// HTTP adapter (Hono/Express/Fastify) is a thin wrapper over these. There is no SQL in this file; the
// handlers call the ContentDB port. Server-authoritative defaults (coin_cost, is_free, is_premium) are
// applied here so a client can never set a price the catalog does not allow. The frozen schema is read,
// never altered: the beats composite FK (a beat's series_id must equal its episode's series) is enforced
// by Postgres and pre-checked here for a clean 400. No em dashes.

import type { operations } from "@axessplayer/contracts/content";

// ---------- contract-bound response shapes ----------
// The contract documents thin 201 (created) and 400 ({ error }) responses plus the 404 for the graph.
// We bind to the generated operations type so a contract drift breaks the typecheck.
export type ApiError = operations["createSeries"]["responses"][400]["content"]["application/json"];

// ---------- enums (frozen schema column comments) ----------
// beats.role: spine|hero|variant|connective|ending|cold_open
export const BEAT_ROLES = ["spine", "hero", "variant", "connective", "ending", "cold_open"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];
// beat_variants.tier: A_filmed|B_likeness|C_ai
export const VARIANT_TIERS = ["A_filmed", "B_likeness", "C_ai"] as const;
export type VariantTier = (typeof VARIANT_TIERS)[number];
// entitlements.scope (used nowhere as a content column, but the brief lists scope as an enum to guard;
// content has no scope column, so we only guard role and tier here). qa_status: pending|passed|rejected
export const QA_STATUSES = ["pending", "passed", "rejected"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

// ---------- request bodies (derived from the schema columns the contract names) ----------
export interface CreateSeriesBody {
  title: string;
  genre?: string | null;
  base_language?: string;
  available_languages?: string[];
  cover_url?: string | null;
}
export interface CreateEpisodeBody {
  series_id: string;
  episode_number: number;
  title?: string | null;
  is_free?: boolean; // server default false
  coin_cost?: number; // server default 0
}
export interface CreateBeatBody {
  series_id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  canon_facts?: Record<string, unknown>;
  is_branch_point?: boolean;
}
export interface CreateVariantBody {
  beat_id: string;
  language?: string; // server default en
  accessibility?: Record<string, unknown>;
  intensity?: number; // 1..5, server default 3
  pov?: string | null;
  tier: VariantTier;
  is_premium?: boolean; // server default false
  coin_cost?: number; // server default 0
  playback_url: string;
  duration_ms?: number | null;
  provenance_id?: string | null;
  qa_status?: QaStatus;
  placement_slots?: unknown[];
}
export interface CreateEdgeBody {
  from_beat_id: string;
  to_beat_id: string;
  condition?: Record<string, unknown>;
}

// ---------- created rows (echoed back in the 201) ----------
export interface SeriesRow {
  id: string;
  title: string;
  genre: string | null;
  base_language: string;
  available_languages: string[];
  cover_url: string | null;
  // 0009b publish state (NULL = draft), 0009c poster art + its C2PA/synthetic provenance. All nullable.
  published_at?: string | null;
  poster_url?: string | null;
  poster_provenance?: Record<string, unknown> | null;
}
export interface EpisodeRow {
  id: string;
  series_id: string;
  episode_number: number;
  title: string | null;
  is_free: boolean;
  coin_cost: number;
}
export interface BeatRow {
  id: string;
  series_id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  canon_facts: Record<string, unknown>;
  is_branch_point: boolean;
}
export interface VariantRow {
  id: string;
  beat_id: string;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  provenance_id: string | null;
  qa_status: QaStatus;
  placement_slots: unknown[];
  // 0009a real accessibility track URLs (Axessible pipeline output). All nullable; dub map is per-language.
  caption_doc_url?: string | null;
  audio_description_url?: string | null;
  sign_video_url?: string | null;
  dub_audio_urls?: Record<string, string>;
}
// The fields settable on an existing variant via PATCH /variants/{id}/tracks (0009a).
export interface VariantTracks {
  caption_doc_url?: string | null;
  audio_description_url?: string | null;
  sign_video_url?: string | null;
  dub_audio_urls?: Record<string, string>;
}
export interface EdgeRow {
  from_beat_id: string;
  to_beat_id: string;
  condition: Record<string, unknown>;
}

// ---------- the resolved playable graph (GET /series/{id}/graph 200 body) ----------
export interface GraphVariant {
  id: string;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  qa_status: QaStatus;
  // 0009a track URLs flow to the player so it renders real captions / AD / sign / dubs.
  caption_doc_url?: string | null;
  audio_description_url?: string | null;
  sign_video_url?: string | null;
  dub_audio_urls?: Record<string, string>;
}
export interface GraphBeat {
  id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  is_branch_point: boolean;
  canon_facts: Record<string, unknown>;
  variants: GraphVariant[];
}
export interface GraphEpisode {
  id: string;
  episode_number: number;
  title: string | null;
  is_free: boolean;
  coin_cost: number;
  beats: GraphBeat[];
}
export interface GraphEdge {
  from_beat_id: string;
  to_beat_id: string;
  condition: Record<string, unknown>;
}
export interface SeriesGraph {
  series: SeriesRow;
  episodes: GraphEpisode[];
  edges: GraphEdge[];
}

// ---------- GET /feed (0009b): published series only ----------
export interface FeedItem {
  id: string;
  title: string;
  genre: string | null;
  cover_url: string | null;
  poster_url: string | null;
  base_language: string;
  available_languages: string[];
  published_at: string;
}
export interface Feed {
  series: FeedItem[];
}

export interface HandlerResult<T> {
  status: number;
  body: T;
}

// ---------- injected data access port ----------
// The handlers depend only on this. The PGlite test adapter and the production node-postgres adapter
// (pgContentDb.ts) both implement it. Create methods receive a fully defaulted, validated row; existence
// and composite-FK checks are surfaced here so the handler can return a clean 400/404.
export interface ContentDB {
  insertSeries(row: Omit<SeriesRow, "id">): Promise<SeriesRow>;
  getEpisode(id: string): Promise<{ id: string; series_id: string } | null>;
  getBeat(id: string): Promise<{ id: string; series_id: string; episode_id: string } | null>;
  seriesExists(id: string): Promise<boolean>;
  insertEpisode(row: Omit<EpisodeRow, "id">): Promise<EpisodeRow>;
  insertBeat(row: Omit<BeatRow, "id">): Promise<BeatRow>;
  insertVariant(row: Omit<VariantRow, "id">): Promise<VariantRow>;
  deleteVariant(id: string): Promise<boolean>;
  setVariantTracks(id: string, tracks: VariantTracks): Promise<VariantRow | null>;
  insertEdge(row: EdgeRow): Promise<EdgeRow>;
  getSeriesGraph(seriesId: string): Promise<SeriesGraph | null>;
  setSeriesPublished(id: string, published: boolean): Promise<{ id: string; published_at: string | null } | null>;
  listPublishedSeries(): Promise<FeedItem[]>;
  setSeriesPoster(id: string, posterUrl: string, provenance: Record<string, unknown>): Promise<{ id: string; poster_url: string } | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(status: number, error: string): HandlerResult<ApiError> {
  return { status, body: { error } };
}

// ---------- GET /series/{id}/graph ----------
export async function handleGetSeriesGraph(
  seriesId: string,
  db: ContentDB
): Promise<HandlerResult<SeriesGraph | ApiError>> {
  if (typeof seriesId !== "string" || !UUID_RE.test(seriesId)) {
    return err(404, "series_not_found");
  }
  const graph = await db.getSeriesGraph(seriesId);
  if (!graph) return err(404, "series_not_found");
  return { status: 200, body: graph };
}

// ---------- POST /series ----------
export async function handleCreateSeries(
  body: CreateSeriesBody,
  db: ContentDB
): Promise<HandlerResult<SeriesRow | ApiError>> {
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return err(400, "invalid_title");
  }
  if (body.genre != null && typeof body.genre !== "string") return err(400, "invalid_genre");
  if (body.base_language != null && typeof body.base_language !== "string") {
    return err(400, "invalid_base_language");
  }
  if (
    body.available_languages != null &&
    (!Array.isArray(body.available_languages) ||
      body.available_languages.some((l) => typeof l !== "string"))
  ) {
    return err(400, "invalid_available_languages");
  }
  if (body.cover_url != null && typeof body.cover_url !== "string") return err(400, "invalid_cover_url");

  const row = await db.insertSeries({
    title: body.title,
    genre: body.genre ?? null,
    base_language: body.base_language ?? "en",
    available_languages: body.available_languages ?? [],
    cover_url: body.cover_url ?? null,
  });
  return { status: 201, body: row };
}

// ---------- POST /episodes ----------
export async function handleCreateEpisode(
  body: CreateEpisodeBody,
  db: ContentDB
): Promise<HandlerResult<EpisodeRow | ApiError>> {
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.series_id !== "string" || !UUID_RE.test(body.series_id)) {
    return err(400, "invalid_series_id");
  }
  if (!Number.isInteger(body.episode_number)) return err(400, "invalid_episode_number");
  if (body.title != null && typeof body.title !== "string") return err(400, "invalid_title");
  if (body.is_free != null && typeof body.is_free !== "boolean") return err(400, "invalid_is_free");
  if (body.coin_cost != null && (!Number.isInteger(body.coin_cost) || body.coin_cost < 0)) {
    return err(400, "invalid_coin_cost");
  }
  if (!(await db.seriesExists(body.series_id))) return err(400, "unknown_series_id");

  // Server-authoritative defaults: a missing price is free, never a client-chosen surprise.
  const row = await db.insertEpisode({
    series_id: body.series_id,
    episode_number: body.episode_number,
    title: body.title ?? null,
    is_free: body.is_free ?? false,
    coin_cost: body.coin_cost ?? 0,
  });
  return { status: 201, body: row };
}

// ---------- POST /beats ----------
export async function handleCreateBeat(
  body: CreateBeatBody,
  db: ContentDB
): Promise<HandlerResult<BeatRow | ApiError>> {
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.series_id !== "string" || !UUID_RE.test(body.series_id)) {
    return err(400, "invalid_series_id");
  }
  if (typeof body.episode_id !== "string" || !UUID_RE.test(body.episode_id)) {
    return err(400, "invalid_episode_id");
  }
  if (!Number.isInteger(body.beat_index)) return err(400, "invalid_beat_index");
  if (!BEAT_ROLES.includes(body.role)) return err(400, "invalid_role");
  if (body.canon_facts != null && !isObject(body.canon_facts)) return err(400, "invalid_canon_facts");
  if (body.is_branch_point != null && typeof body.is_branch_point !== "boolean") {
    return err(400, "invalid_is_branch_point");
  }

  // Composite-FK integrity (M2): the beat's series_id must equal its episode's series. Postgres enforces
  // this with the (episode_id, series_id) FK; we pre-check for a clean 400 instead of a raw DB error.
  const episode = await db.getEpisode(body.episode_id);
  if (!episode) return err(400, "unknown_episode_id");
  if (episode.series_id !== body.series_id) return err(400, "series_episode_mismatch");

  const row = await db.insertBeat({
    series_id: body.series_id,
    episode_id: body.episode_id,
    beat_index: body.beat_index,
    role: body.role,
    canon_facts: body.canon_facts ?? {},
    is_branch_point: body.is_branch_point ?? false,
  });
  return { status: 201, body: row };
}

// ---------- POST /variants ----------
export async function handleCreateVariant(
  body: CreateVariantBody,
  db: ContentDB
): Promise<HandlerResult<VariantRow | ApiError>> {
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.beat_id !== "string" || !UUID_RE.test(body.beat_id)) {
    return err(400, "invalid_beat_id");
  }
  if (!VARIANT_TIERS.includes(body.tier)) return err(400, "invalid_tier");
  if (typeof body.playback_url !== "string" || body.playback_url.length === 0) {
    return err(400, "invalid_playback_url");
  }
  if (body.language != null && typeof body.language !== "string") return err(400, "invalid_language");
  if (body.accessibility != null && !isObject(body.accessibility)) {
    return err(400, "invalid_accessibility");
  }
  if (
    body.intensity != null &&
    (!Number.isInteger(body.intensity) || body.intensity < 1 || body.intensity > 5)
  ) {
    return err(400, "invalid_intensity");
  }
  if (body.pov != null && typeof body.pov !== "string") return err(400, "invalid_pov");
  if (body.is_premium != null && typeof body.is_premium !== "boolean") {
    return err(400, "invalid_is_premium");
  }
  if (body.coin_cost != null && (!Number.isInteger(body.coin_cost) || body.coin_cost < 0)) {
    return err(400, "invalid_coin_cost");
  }
  if (body.duration_ms != null && (!Number.isInteger(body.duration_ms) || body.duration_ms < 0)) {
    return err(400, "invalid_duration_ms");
  }
  if (body.provenance_id != null && (typeof body.provenance_id !== "string" || !UUID_RE.test(body.provenance_id))) {
    return err(400, "invalid_provenance_id");
  }
  if (body.qa_status != null && !QA_STATUSES.includes(body.qa_status)) {
    return err(400, "invalid_qa_status");
  }
  if (body.placement_slots != null && !Array.isArray(body.placement_slots)) {
    return err(400, "invalid_placement_slots");
  }
  if (!(await db.getBeat(body.beat_id))) return err(400, "unknown_beat_id");

  // Server-authoritative pricing: is_premium and coin_cost default to a free, non-premium variant.
  const row = await db.insertVariant({
    beat_id: body.beat_id,
    language: body.language ?? "en",
    accessibility: body.accessibility ?? {},
    intensity: body.intensity ?? 3,
    pov: body.pov ?? null,
    tier: body.tier,
    is_premium: body.is_premium ?? false,
    coin_cost: body.coin_cost ?? 0,
    playback_url: body.playback_url,
    duration_ms: body.duration_ms ?? null,
    provenance_id: body.provenance_id ?? null,
    qa_status: body.qa_status ?? "pending",
    placement_slots: body.placement_slots ?? [],
  });
  return { status: 201, body: row };
}

// ---------- DELETE /variants/{id} ----------
// Remove a beat_variant (an uploaded or registered cut). Idempotent at the API: a valid uuid that is not
// present returns 404 variant_not_found, while a successful delete returns 200 with the id. The media bytes on
// the ingest server are removed separately by the caller (the Studio), since the content DB owns only the row.
export async function handleDeleteVariant(
  variantId: string,
  db: ContentDB
): Promise<HandlerResult<{ id: string; deleted: true } | ApiError>> {
  if (typeof variantId !== "string" || !UUID_RE.test(variantId)) return err(400, "invalid_variant_id");
  const deleted = await db.deleteVariant(variantId);
  if (!deleted) return err(404, "variant_not_found");
  return { status: 200, body: { id: variantId, deleted: true } };
}

// ---------- PATCH /variants/{id}/tracks (0009a) ----------
// Attach real accessibility track URLs (produced by the Axessible pipeline) to an existing variant. Only the
// provided fields are set; omitted fields are left unchanged. Validates each url is a string when present.
export async function handleSetVariantTracks(
  variantId: string,
  body: unknown,
  db: ContentDB
): Promise<HandlerResult<VariantRow | ApiError>> {
  if (typeof variantId !== "string" || !UUID_RE.test(variantId)) return err(400, "invalid_variant_id");
  if (!isObject(body)) return err(400, "invalid_body");
  const tracks: VariantTracks = {};
  for (const key of ["caption_doc_url", "audio_description_url", "sign_video_url"] as const) {
    if (body[key] != null) {
      if (typeof body[key] !== "string") return err(400, `invalid_${key}`);
      tracks[key] = body[key] as string;
    }
  }
  if (body.dub_audio_urls != null) {
    if (!isObject(body.dub_audio_urls)) return err(400, "invalid_dub_audio_urls");
    for (const v of Object.values(body.dub_audio_urls)) {
      if (typeof v !== "string") return err(400, "invalid_dub_audio_urls");
    }
    tracks.dub_audio_urls = body.dub_audio_urls as Record<string, string>;
  }
  const row = await db.setVariantTracks(variantId, tracks);
  if (!row) return err(404, "variant_not_found");
  return { status: 200, body: row };
}

// ---------- POST /series/{id}/publish and /unpublish (0009b) ----------
export async function handleSetSeriesPublished(
  seriesId: string,
  published: boolean,
  db: ContentDB
): Promise<HandlerResult<{ id: string; published_at: string | null } | ApiError>> {
  if (typeof seriesId !== "string" || !UUID_RE.test(seriesId)) return err(400, "invalid_series_id");
  const row = await db.setSeriesPublished(seriesId, published);
  if (!row) return err(404, "series_not_found");
  return { status: 200, body: row };
}

// ---------- GET /feed (0009b): published series only, newest first ----------
export async function handleGetFeed(db: ContentDB): Promise<HandlerResult<Feed>> {
  return { status: 200, body: { series: await db.listPublishedSeries() } };
}

// ---------- PATCH /series/{id}/poster (0009c) ----------
// Store the chosen generated poster URL on the series, with its C2PA / synthetic provenance (Article 50).
export async function handleSetSeriesPoster(
  seriesId: string,
  body: unknown,
  db: ContentDB
): Promise<HandlerResult<{ id: string; poster_url: string } | ApiError>> {
  if (typeof seriesId !== "string" || !UUID_RE.test(seriesId)) return err(400, "invalid_series_id");
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.poster_url !== "string" || body.poster_url.length === 0) return err(400, "invalid_poster_url");
  const provenance = isObject(body.provenance) ? body.provenance : { c2pa: true, synthetic: true };
  const row = await db.setSeriesPoster(seriesId, body.poster_url, provenance);
  if (!row) return err(404, "series_not_found");
  return { status: 200, body: row };
}

// ---------- POST /edges ----------
export async function handleCreateEdge(
  body: CreateEdgeBody,
  db: ContentDB
): Promise<HandlerResult<EdgeRow | ApiError>> {
  if (!isObject(body)) return err(400, "invalid_body");
  if (typeof body.from_beat_id !== "string" || !UUID_RE.test(body.from_beat_id)) {
    return err(400, "invalid_from_beat_id");
  }
  if (typeof body.to_beat_id !== "string" || !UUID_RE.test(body.to_beat_id)) {
    return err(400, "invalid_to_beat_id");
  }
  if (body.from_beat_id === body.to_beat_id) return err(400, "self_edge");
  if (body.condition != null && !isObject(body.condition)) return err(400, "invalid_condition");

  const from = await db.getBeat(body.from_beat_id);
  const to = await db.getBeat(body.to_beat_id);
  if (!from) return err(400, "unknown_from_beat_id");
  if (!to) return err(400, "unknown_to_beat_id");
  // An edge must stay inside one series: the player walks the graph within a series boundary.
  if (from.series_id !== to.series_id) return err(400, "cross_series_edge");

  const row = await db.insertEdge({
    from_beat_id: body.from_beat_id,
    to_beat_id: body.to_beat_id,
    condition: body.condition ?? {},
  });
  return { status: 201, body: row };
}
