// Pure query builders + result mappers for the catalog service. Every function here is side-effect-free:
// it either builds a { text, values } SQL spec or maps raw pg rows to the CATALOG API CONTRACT response
// shape. No I/O, no pg import. The HTTP layer (server.ts) runs the specs against a real pg.Pool; the unit
// tests (test/queries.test.ts) run them against a fake pg to assert SQL shape and mapping. This split is
// the testability seam: the SQL text and the row->payload derivation are verified without a database.
//
// All table names are UNQUALIFIED so DB_OPTIONS=-c search_path=mobile,public resolves them to the mobile
// overlay schema, exactly as the content/decision services do. Read-only except the /calibrate write, which
// MERGES into viewer_state.preference_vector via jsonb concatenation (does not clobber other keys). No em
// dashes.

import {
  checkCanon,
  labelNodeKind,
  type CanonResult,
  type GraphEdge,
  type GraphNode,
  type MemoryVar,
  type NodeKind,
} from "./storygraph.js";
import { liftBand, type Band, type BandVerdict } from "./bands.js";

// A built SQL statement: parameterized text plus its positional values. Mirrors the pg.query call shape.
export interface SqlSpec {
  text: string;
  values: unknown[];
}

// The narrow database port the builders run against. Structurally satisfied by pg.Pool and by the fake pg
// in the unit tests. Kept to the single method the catalog service uses.
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

// ---------------------------------------------------------------------------------------------------
// Calibrate input -> preference_vector merge fields.
// ---------------------------------------------------------------------------------------------------

export type Pace = "slow_burn" | "tense";

export interface CalibrateInput {
  pace: Pace;
  pov: string;
  intensity: number;
}

// Validate and normalize a raw /calibrate body into a typed CalibrateInput, or null when invalid. pace is
// the closed set from the contract; pov is a non-empty string; intensity is coerced to an integer 1..5
// (the beat_variants.intensity domain). Pure: no throw, returns null for the route to map to a 400.
export function parseCalibrateInput(raw: unknown): CalibrateInput | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pace = o.pace;
  if (pace !== "slow_burn" && pace !== "tense") return null;
  const pov = o.pov;
  if (typeof pov !== "string" || pov.trim().length === 0) return null;
  const rawIntensity = o.intensity;
  const n = typeof rawIntensity === "number" ? rawIntensity : Number(rawIntensity);
  if (!Number.isFinite(n)) return null;
  const intensity = Math.max(1, Math.min(5, Math.round(n)));
  return { pace, pov: pov.trim(), intensity };
}

// The preference_vector fragment a calibration writes. Kept as its own object so the merge is explicit and
// the test can assert exactly which keys are set. updated_at is set by the SQL, not here.
export function calibrationVector(input: CalibrateInput): Record<string, unknown> {
  return { pace: input.pace, pov: input.pov, intensity: input.intensity };
}

// UPSERT that MERGES the calibration fragment into viewer_state.preference_vector without clobbering other
// keys. On insert the row starts from the fragment; on conflict the existing jsonb is concatenated with the
// fragment (right side wins for overlapping keys: pace/pov/intensity), so unrelated keys survive. A NULL
// series_id is allowed by the overlay (the PK is (user_id, series_id) but calibration is account-level here;
// the contract carries no seriesId, so we pin a single account-level row using the all-zero series sentinel
// to satisfy the composite PK while leaving real per-series vectors untouched).
export const ACCOUNT_SERIES_SENTINEL = "00000000-0000-0000-0000-000000000000";

export function buildCalibrateUpsert(userId: string, input: CalibrateInput): SqlSpec {
  const fragment = calibrationVector(input);
  return {
    text: `insert into viewer_state (user_id, series_id, preference_vector, updated_at)
       values ($1, $2, $3::jsonb, now())
     on conflict (user_id, series_id)
       do update set preference_vector = viewer_state.preference_vector || excluded.preference_vector,
                     updated_at = now()
     returning preference_vector`,
    values: [userId, ACCOUNT_SERIES_SENTINEL, JSON.stringify(fragment)],
  };
}

// The payoff summary + badge returned by /calibrate. A short, human payoff string keyed on the chosen pace,
// plus the constant 'CUT FOR YOU' badge from the contract. Pure mapping from the calibration input.
export function calibratePayoff(input: CalibrateInput): { summary: string; badge: "CUT FOR YOU" } {
  const tempo =
    input.pace === "tense" ? "tense, high-stakes cuts" : "slow-burn cuts that let scenes breathe";
  const summary = `We will favor ${tempo} from ${input.pov}, dialed to intensity ${input.intensity}/5.`;
  return { summary, badge: "CUT FOR YOU" };
}

// ---------------------------------------------------------------------------------------------------
// GET /continue : resume items from viewer_state progress + beats.
// ---------------------------------------------------------------------------------------------------

export interface ContinueItem {
  seriesId: string;
  title: string;
  poster: string | null;
  beatId: string | null;
  progress: number;
}

// Resume list for a viewer. progress is read from viewer_state.preference_vector ->> 'progress' (the player
// writes resume progress there alongside the calibration keys), and the in-progress beat from
// ->> 'beat_id'. We join series for the title/poster and exclude the account-level sentinel row and rows
// with no progress. Ordered by most recently updated so the freshest resume is first.
export function buildContinueQuery(userId: string): SqlSpec {
  return {
    text: `select s.id as series_id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            vs.preference_vector ->> 'beat_id' as beat_id,
            coalesce((vs.preference_vector ->> 'progress')::float, 0) as progress
       from viewer_state vs
       join series s on s.id = vs.series_id
      where vs.user_id = $1
        and vs.series_id <> $2
        and (vs.preference_vector ? 'progress')
      order by vs.updated_at desc`,
    values: [userId, ACCOUNT_SERIES_SENTINEL],
  };
}

export function mapContinueRows(rows: Array<Record<string, unknown>>): ContinueItem[] {
  return rows.map((r) => ({
    seriesId: String(r.series_id),
    title: String(r.title ?? ""),
    poster: r.poster == null ? null : String(r.poster),
    beatId: r.beat_id == null ? null : String(r.beat_id),
    progress: clampProgress(r.progress),
  }));
}

function clampProgress(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------------------------------
// GET /trending : engagement_events aggregation with a sparse-events fallback.
// ---------------------------------------------------------------------------------------------------

export interface TrendingItem {
  seriesId: string;
  title: string;
  poster: string | null;
  genre: string | null;
}

// Trending by recent engagement: count play/completion_50/episode_completed events per series within the
// recent window (default 14 days), join series for the card fields, order by event count desc. Only counts
// engagement-bearing event types so a chatty UI event does not distort the ranking.
export const TRENDING_EVENT_TYPES = ["play", "completion_50", "episode_completed"] as const;

export function buildTrendingQuery(limit = 20, windowDays = 14): SqlSpec {
  return {
    text: `select s.id as series_id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            s.genre as genre,
            count(e.id) as score
       from engagement_events e
       join series s on s.id = e.series_id
      where e.type = any($1)
        and e.ts >= now() - ($2 || ' days')::interval
      group by s.id, s.title, poster, s.genre
      order by score desc, s.title asc
      limit $3`,
    values: [Array.from(TRENDING_EVENT_TYPES), String(windowDays), limit],
  };
}

// Sparse-events fallback: most recently published series. Used when the events aggregation returns fewer
// rows than a small threshold, so a fresh deployment with no traffic still shows a populated trending rail.
export function buildTrendingFallbackQuery(limit = 20): SqlSpec {
  return {
    text: `select s.id as series_id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            s.genre as genre
       from series s
      where s.published_at is not null
      order by s.published_at desc
      limit $1`,
    values: [limit],
  };
}

export function mapTrendingRows(rows: Array<Record<string, unknown>>): TrendingItem[] {
  return rows.map((r) => ({
    seriesId: String(r.series_id),
    title: String(r.title ?? ""),
    poster: r.poster == null ? null : String(r.poster),
    genre: r.genre == null ? null : String(r.genre),
  }));
}

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/detail : series + episodes/beats + beat_variants, with a11y chips derived from tracks.
// ---------------------------------------------------------------------------------------------------

export interface SeriesDetail {
  hero: { id: string; title: string; poster: string | null; genre: string | null };
  genre: string | null;
  format: string;
  episodeCount: number;
  endingsCount: number;
  a11y: { cc: boolean; ad: boolean; sign: boolean; langs: number };
  episodes: Array<{ id: string; number: number; coinCost: number; locked: boolean }>;
}

// Series header row. format defaults to 'Series' to match the additive column default.
export function buildSeriesHeaderQuery(seriesId: string): SqlSpec {
  return {
    text: `select s.id as id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            s.genre as genre,
            coalesce(s.format, 'Series') as format
       from series s
      where s.id = $1`,
    values: [seriesId],
  };
}

// Episodes for the series, with the server-authoritative coin cost and the locked flag. An episode is
// locked when it costs coins and is not free (is_free=false). Ordered by episode number.
export function buildSeriesEpisodesQuery(seriesId: string): SqlSpec {
  return {
    text: `select e.id as id,
            e.episode_number as number,
            e.coin_cost as coin_cost,
            (coalesce(e.is_free, false) = false and e.coin_cost > 0) as locked
       from episodes e
      where e.series_id = $1
      order by e.episode_number asc`,
    values: [seriesId],
  };
}

// Accessibility-track presence + ending count + language count across all variants of the series, computed
// in one pass over beat_variants joined through beats. The boolean aggregates drive the cc/ad/sign chips;
// distinct non-null languages drive the langs count; ending-flagged variants (is_ending true OR the
// substrate axis/kind marking an ending) drive endingsCount.
export function buildSeriesA11yQuery(seriesId: string): SqlSpec {
  return {
    text: `select
            bool_or(v.caption_doc_url is not null) as has_cc,
            bool_or(v.audio_description_url is not null) as has_ad,
            bool_or(v.sign_video_url is not null) as has_sign,
            count(distinct v.language) filter (where v.language is not null) as lang_count,
            count(distinct v.id) filter (
              where coalesce(v.is_ending, false) = true
                 or v.variant_kind = 'alt_ending'
                 or v.axis = 'ending'
            ) as endings_count
       from beat_variants v
       join beats b on b.id = v.beat_id
      where b.series_id = $1`,
    values: [seriesId],
  };
}

// Compose the detail payload from the three result sets. Pure mapping; throws nothing, returns null when
// the series header is absent so the route can answer 404.
export function composeSeriesDetail(
  headerRows: Array<Record<string, unknown>>,
  episodeRows: Array<Record<string, unknown>>,
  a11yRows: Array<Record<string, unknown>>
): SeriesDetail | null {
  const h = headerRows[0];
  if (h == null) return null;
  const a = a11yRows[0] ?? {};
  const episodes = episodeRows.map((r) => ({
    id: String(r.id),
    number: toInt(r.number),
    coinCost: toInt(r.coin_cost),
    locked: r.locked === true,
  }));
  return {
    hero: {
      id: String(h.id),
      title: String(h.title ?? ""),
      poster: h.poster == null ? null : String(h.poster),
      genre: h.genre == null ? null : String(h.genre),
    },
    genre: h.genre == null ? null : String(h.genre),
    format: String(h.format ?? "Series"),
    episodeCount: episodes.length,
    endingsCount: toInt(a.endings_count),
    a11y: {
      cc: a.has_cc === true,
      ad: a.has_ad === true,
      sign: a.has_sign === true,
      langs: toInt(a.lang_count),
    },
    episodes,
  };
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/cuts : premium / alternate cuts per beat from the variant substrate.
//
// CUTS API CONTRACT: [{ beatId, beatLabel, cuts:[{ variantId, kind, label, coinCost, isPremium }] }].
// We select from beat_variants joined through beats for the series, keeping only the cut-bearing variants:
// those whose variant_kind is one of the alternate-cut kinds (alt_ending|pov|intensity) OR that are flagged
// premium (is_premium). The master/dub/a11y/etc variants are NOT cuts and are excluded unless premium. Rows
// are ordered by beat (beat_index) then variant id so grouping is stable; the mapper buckets them per beat.
// Read-only, unqualified names so search_path=mobile resolves the overlay.
// ---------------------------------------------------------------------------------------------------

// The alternate-cut variant kinds the cuts endpoint surfaces. A variant qualifies as a cut when its
// variant_kind is in this set OR it is premium (is_premium). Mirrors the contract's kind union.
export const CUT_VARIANT_KINDS = ["alt_ending", "pov", "intensity"] as const;
export type CutKind = (typeof CUT_VARIANT_KINDS)[number];

export interface CutVariant {
  variantId: string;
  kind: CutKind;
  label: string;
  coinCost: number;
  isPremium: boolean;
}

export interface BeatCuts {
  beatId: string;
  beatLabel: string;
  cuts: CutVariant[];
}

// Select the cut-bearing variants for every beat of the series. The WHERE keeps a variant when its kind is
// an alternate cut OR it is premium, so a premium variant of any kind still surfaces as a paid cut. Ordered
// by beat_index then variant id for deterministic grouping. is_premium / coin_cost are coalesced to safe
// defaults so a substrate row that left them null still maps cleanly.
export function buildSeriesCutsQuery(seriesId: string): SqlSpec {
  return {
    text: `select b.id as beat_id,
            b.beat_index as beat_index,
            b.role as beat_role,
            v.id as variant_id,
            v.variant_kind as variant_kind,
            v.axis as axis,
            v.axis_value as axis_value,
            coalesce(v.coin_cost, 0) as coin_cost,
            coalesce(v.is_premium, false) as is_premium
       from beat_variants v
       join beats b on b.id = v.beat_id
      where b.series_id = $1
        and (v.variant_kind = any($2) or coalesce(v.is_premium, false) = true)
      order by b.beat_index asc, v.id asc`,
    values: [seriesId, Array.from(CUT_VARIANT_KINDS)],
  };
}

// Map a raw row's variant_kind to the contract's CutKind. When the row qualified only by being premium and
// its variant_kind is outside the cut union (e.g. master|dub|a11y|brand), we fall back to 'intensity' as the
// neutral paid-cut kind so the contract's closed union is never violated. Pure.
export function cutKindFromRow(variantKind: unknown): CutKind {
  const k = typeof variantKind === "string" ? variantKind : "";
  return (CUT_VARIANT_KINDS as readonly string[]).includes(k) ? (k as CutKind) : "intensity";
}

// Human label for a cut. Prefer the substrate axis_value (the character for a POV cut, the ending name for
// an alt_ending, the intensity level, etc.); when absent, fall back to a title-cased variant_kind so the
// UI always has something readable. Pure.
export function cutLabelFromRow(axisValue: unknown, variantKind: unknown): string {
  const v = typeof axisValue === "string" ? axisValue.trim() : "";
  if (v.length > 0) return v;
  const k = typeof variantKind === "string" ? variantKind : "";
  return titleCaseKind(k);
}

// Title-case a snake/lower kind token for display ('alt_ending' -> 'Alt Ending'). Empty input -> 'Cut'.
function titleCaseKind(kind: string): string {
  const parts = kind.split("_").filter((p) => p.length > 0);
  if (parts.length === 0) return "Cut";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

// Human label for a beat. No dedicated label/title column exists on beats in the mobile overlay, so we
// derive a stable label from role + beat_index ('Climax (Beat 4)'), falling back to 'Beat N' when role is
// absent. Pure.
export function beatLabelFromRow(role: unknown, beatIndex: unknown): string {
  const n = toInt(beatIndex);
  const r = typeof role === "string" ? role.trim() : "";
  if (r.length > 0) return `${titleCaseKind(r)} (Beat ${n})`;
  return `Beat ${n}`;
}

// Bucket the flat cut rows into per-beat groups, preserving the query's beat_index/variant ordering. The
// first row seen for a beat sets its label; subsequent rows append their cut. Pure mapping; returns the
// contract's BeatCuts[] shape.
export function mapSeriesCutsRows(rows: Array<Record<string, unknown>>): BeatCuts[] {
  const order: string[] = [];
  const byBeat = new Map<string, BeatCuts>();
  for (const r of rows) {
    const beatId = String(r.beat_id);
    let group = byBeat.get(beatId);
    if (group == null) {
      group = { beatId, beatLabel: beatLabelFromRow(r.beat_role, r.beat_index), cuts: [] };
      byBeat.set(beatId, group);
      order.push(beatId);
    }
    group.cuts.push({
      variantId: String(r.variant_id),
      kind: cutKindFromRow(r.variant_kind),
      label: cutLabelFromRow(r.axis_value, r.variant_kind),
      coinCost: toInt(r.coin_cost),
      isPremium: r.is_premium === true,
    });
  }
  return order.map((id) => byBeat.get(id) as BeatCuts);
}

// ---------------------------------------------------------------------------------------------------
// GET /search?q= : series titles, character names (POV-cut axis values), and channels.
// ---------------------------------------------------------------------------------------------------

export interface SearchResults {
  shows: Array<{ seriesId: string; title: string; poster: string | null; genre: string | null }>;
  characters: Array<{ name: string; seriesId: string }>;
  channels: Array<{ id: string; slug: string; name: string }>;
}

// Build the case-insensitive LIKE pattern for a raw query, escaping the LIKE metacharacters so a user's %
// or _ is matched literally. Pure helper shared by the three search specs.
export function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}

export function buildSearchShowsQuery(q: string, limit = 20): SqlSpec {
  return {
    text: `select s.id as series_id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            s.genre as genre
       from series s
      where s.title ilike $1 escape '\\'
      order by s.title asc
      limit $2`,
    values: [likePattern(q), limit],
  };
}

// Characters are surfaced from the variant substrate: a POV cut carries the character on axis='pov' with
// the character name in axis_value. There is no dedicated character table in the mobile overlay (characters
// live in services/social, not built), so the catalog derives the searchable character set from the cuts
// that exist. Distinct (name, series) pairs.
export function buildSearchCharactersQuery(q: string, limit = 20): SqlSpec {
  return {
    text: `select distinct v.axis_value as name, b.series_id as series_id
       from beat_variants v
       join beats b on b.id = v.beat_id
      where v.axis = 'pov'
        and v.axis_value is not null
        and v.axis_value ilike $1 escape '\\'
      order by v.axis_value asc
      limit $2`,
    values: [likePattern(q), limit],
  };
}

export function buildSearchChannelsQuery(q: string, limit = 20): SqlSpec {
  return {
    text: `select c.id as id, c.slug as slug, c.name as name
       from channels c
      where c.name ilike $1 escape '\\' or c.slug ilike $1 escape '\\'
      order by c.name asc
      limit $2`,
    values: [likePattern(q), limit],
  };
}

export function mapSearchResults(
  showRows: Array<Record<string, unknown>>,
  characterRows: Array<Record<string, unknown>>,
  channelRows: Array<Record<string, unknown>>
): SearchResults {
  return {
    shows: showRows.map((r) => ({
      seriesId: String(r.series_id),
      title: String(r.title ?? ""),
      poster: r.poster == null ? null : String(r.poster),
      genre: r.genre == null ? null : String(r.genre),
    })),
    characters: characterRows.map((r) => ({
      name: String(r.name ?? ""),
      seriesId: String(r.series_id),
    })),
    channels: channelRows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug ?? ""),
      name: String(r.name ?? ""),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------
// GET /channels : the channel rail. Each channel joined to series_channels for its showCount.
// ---------------------------------------------------------------------------------------------------

export interface ChannelSummary {
  id: string;
  slug: string;
  name: string;
  genres: string[];
  heroUrl: string | null;
  showCount: number;
}

// All channels with their show count. LEFT JOIN series_channels so a channel with zero mapped series
// still appears (showCount 0). count(sc.series_id) counts only the joined rows (NULL on the empty side is
// not counted), giving the real mapping count. hero_url is the channel's own art column on the mobile
// overlay; genres is its text[] tag column. Ordered by name for a stable rail.
export function buildChannelsQuery(): SqlSpec {
  return {
    text: `select c.id as id,
            c.slug as slug,
            c.name as name,
            coalesce(c.genres, '{}') as genres,
            c.hero_url as hero_url,
            count(sc.series_id) as show_count
       from channels c
       left join series_channels sc on sc.channel_id = c.id
      group by c.id, c.slug, c.name, c.genres, c.hero_url
      order by c.name asc`,
    values: [],
  };
}

// Coerce a pg text[] / array-ish value into a string[]. node-postgres returns a JS array for text[]; we
// also tolerate null (-> []) and defensively map non-array scalars to []. Pure helper.
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

export function mapChannelRows(rows: Array<Record<string, unknown>>): ChannelSummary[] {
  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    genres: toStringArray(r.genres),
    heroUrl: r.hero_url == null ? null : String(r.hero_url),
    showCount: toInt(r.show_count),
  }));
}

// ---------------------------------------------------------------------------------------------------
// GET /channel/:id : channel header + its series, each with a derived rating/episode count + a11y badges.
// ---------------------------------------------------------------------------------------------------

export interface ChannelSeriesItem {
  seriesId: string;
  title: string;
  poster: string | null;
  rating: number;
  episodes: number;
  badges: { cc: boolean; ad: boolean; sign: boolean };
}

export interface ChannelDetail {
  id: string;
  name: string;
  heroUrl: string | null;
  showCount: number;
  series: ChannelSeriesItem[];
}

// Channel header. Single row; the route answers 404 when it is absent.
export function buildChannelHeaderQuery(channelId: string): SqlSpec {
  return {
    text: `select c.id as id,
            c.name as name,
            c.hero_url as hero_url
       from channels c
      where c.id = $1`,
    values: [channelId],
  };
}

// The series mapped to a channel, with the per-series derivations the card needs, computed in one pass:
//   - poster from series.poster_url with cover_url fallback (mirrors the rest of the catalog),
//   - episodes = count of distinct episodes in the series,
//   - rating derived from accessibility coverage (no rating column exists in the overlay): a base of 3.5
//     plus 0.5 per present a11y track (cc/ad/sign), capped at 5.0, so richer-access titles surface higher,
//   - badges cc/ad/sign from beat_variants track-URL presence (same derivation as series detail), via the
//     beats -> beat_variants join. LEFT JOINs so a series with no episodes/variants still appears.
// Grouped per series; ordered by title for a stable grid.
export function buildChannelSeriesQuery(channelId: string): SqlSpec {
  return {
    text: `select s.id as series_id,
            s.title as title,
            coalesce(s.poster_url, s.cover_url) as poster,
            count(distinct e.id) as episode_count,
            bool_or(v.caption_doc_url is not null) as has_cc,
            bool_or(v.audio_description_url is not null) as has_ad,
            bool_or(v.sign_video_url is not null) as has_sign
       from series_channels sc
       join series s on s.id = sc.series_id
       left join episodes e on e.series_id = s.id
       left join beats b on b.series_id = s.id
       left join beat_variants v on v.beat_id = b.id
      where sc.channel_id = $1
      group by s.id, s.title, poster
      order by s.title asc`,
    values: [channelId],
  };
}

// Derive a 0..5 rating from accessibility coverage. No rating column exists in the mobile overlay, so the
// catalog derives a stable, deterministic rating that rewards access depth: base 3.5, +0.5 per present
// track, capped at 5.0. Pure.
export function deriveAccessibilityRating(cc: boolean, ad: boolean, sign: boolean): number {
  const present = (cc ? 1 : 0) + (ad ? 1 : 0) + (sign ? 1 : 0);
  const rating = 3.5 + present * 0.5;
  return Math.min(5, rating);
}

// Compose the channel detail from the header + series result sets. Returns null when the header is absent
// so the route can answer 404. showCount is the count of mapped series returned (the channel/:id payload's
// own series array length), consistent with the rail's showCount derivation.
export function composeChannelDetail(
  headerRows: Array<Record<string, unknown>>,
  seriesRows: Array<Record<string, unknown>>
): ChannelDetail | null {
  const h = headerRows[0];
  if (h == null) return null;
  const series = seriesRows.map((r) => {
    const cc = r.has_cc === true;
    const ad = r.has_ad === true;
    const sign = r.has_sign === true;
    return {
      seriesId: String(r.series_id),
      title: String(r.title ?? ""),
      poster: r.poster == null ? null : String(r.poster),
      rating: deriveAccessibilityRating(cc, ad, sign),
      episodes: toInt(r.episode_count),
      badges: { cc, ad, sign },
    };
  });
  return {
    id: String(h.id),
    name: String(h.name ?? ""),
    heroUrl: h.hero_url == null ? null : String(h.hero_url),
    showCount: series.length,
    series,
  };
}

// ===================================================================================================
// CREATOR-SCOPED endpoints (session-authed; the studio sends a creator session bearer).
// ===================================================================================================

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/graph : the branch-editor graph composed from the hosted content graph.
//
// series -> episodes -> beats -> beat_variants + beat_edges. Node kinds are labeled from
// variant_kind / is_branch_point / is_ending flags (storygraph.ts); edges come from beat_edges with
// isDefault derived from an empty/null condition; memoryVars is derived empty with a TODO (no story-graph
// memory table exists in the hosted schema); pricing is the per-beat minimum premium coin_cost; canon is
// the reachability + dangling-edge + branch-default validity check (storygraph.ts). Read-only; unqualified
// names so search_path=mobile resolves the overlay. Mirrors the admin-api composition but lives here so
// catalog stays a standalone deployable.
// ---------------------------------------------------------------------------------------------------

// Existence gate: a single-row series lookup so an unknown series is a clean 404 rather than an
// empty-but-present graph.
export function buildSeriesExistsQuery(seriesId: string): SqlSpec {
  return { text: `select s.id as id from series s where s.id = $1`, values: [seriesId] };
}

// Beats of the series, with the spine fields the editor lays out by. Ordered by episode then beat_index so
// the composed node list is stable.
export function buildGraphBeatsQuery(seriesId: string): SqlSpec {
  return {
    text: `select b.id as id,
            b.episode_id as episode_id,
            b.beat_index as beat_index,
            b.role as role,
            coalesce(b.is_branch_point, false) as is_branch_point
       from beats b
      where b.series_id = $1
      order by b.episode_id asc, b.beat_index asc`,
    values: [seriesId],
  };
}

// Per-beat variant flags folded in one pass over beat_variants: whether any variant is premium / a branch
// point / an ending, the variant axis (pov|intensity) when present, whether any premium variant carries an
// entitlement scope (a hard lock), and the minimum premium coin_cost (the creator-set price to enter the
// node). Grouped per beat. is_branch_point / is_ending / entitlement_scope are substrate columns.
export function buildGraphVariantFlagsQuery(seriesId: string): SqlSpec {
  return {
    text: `select b.id as beat_id,
            bool_or(coalesce(v.is_premium, false)) as any_premium,
            bool_or(coalesce(v.is_branch_point, false)) as any_branch,
            bool_or(coalesce(v.is_ending, false)) as any_ending,
            bool_or(coalesce(v.is_premium, false) and v.entitlement_scope is not null) as any_locked,
            min(v.coin_cost) filter (where coalesce(v.is_premium, false) = true) as min_premium_cost,
            max(v.variant_kind) filter (where v.variant_kind in ('pov', 'intensity')) as axis_kind
       from beats b
       left join beat_variants v on v.beat_id = b.id
      where b.series_id = $1
      group by b.id`,
    values: [seriesId],
  };
}

// beat_edges of the series. Both endpoints are constrained to beats of THIS series via the join so an edge
// that leaks across series is not returned. condition drives the isDefault flag (empty/null = canon).
export function buildGraphEdgesQuery(seriesId: string): SqlSpec {
  return {
    text: `select e.from_beat_id as from_beat_id,
            e.to_beat_id as to_beat_id,
            e.condition as condition
       from beat_edges e
       join beats bf on bf.id = e.from_beat_id and bf.series_id = $1
       join beats bt on bt.id = e.to_beat_id and bt.series_id = $1`,
    values: [seriesId],
  };
}

// An edge is the canon default-fallback when its condition is null or an empty object. A populated
// condition is a guarded branch edge; we reduce it to a short choice label for display. Pure.
export function edgeChoiceLabel(condition: unknown): string | null {
  if (condition == null) return null;
  if (typeof condition === "object") {
    const keys = Object.keys(condition as Record<string, unknown>);
    if (keys.length === 0) return null;
    return keys.join(",");
  }
  const s = String(condition).trim();
  return s.length === 0 ? null : s;
}

// Map the substrate variant_kind to a node axis label. Only pov/intensity participate in axis labeling.
export function axisOf(variantKind: unknown): string | null {
  if (variantKind === "pov") return "pov";
  if (variantKind === "intensity") return "intensity";
  return null;
}

export interface SeriesGraph {
  seriesId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  memoryVars: MemoryVar[];
  // Set when memoryVars could not be read from a real story-graph source and were derived empty, so the
  // studio shows a "memory variables not yet modeled" note rather than implying the story has none.
  memoryVarsTodo?: string;
  pricing: Array<{ nodeId: string; kind: NodeKind; coinCost: number }>;
  canon: CanonResult;
}

// Compose the branch-editor graph from the three result sets. Pure mapping; returns null when the series
// is absent (existsRows empty) so the route can answer 404.
export function composeSeriesGraph(
  seriesId: string,
  existsRows: Array<Record<string, unknown>>,
  beatRows: Array<Record<string, unknown>>,
  flagRows: Array<Record<string, unknown>>,
  edgeRows: Array<Record<string, unknown>>,
): SeriesGraph | null {
  if (existsRows[0] == null) return null;

  const flagByBeat = new Map<string, Record<string, unknown>>();
  for (const f of flagRows) flagByBeat.set(String(f.beat_id), f);

  const nodes: GraphNode[] = beatRows.map((b) => {
    const f = flagByBeat.get(String(b.id));
    const isEnding = f?.any_ending === true || b.role === "ending";
    const isBranchPoint = b.is_branch_point === true || f?.any_branch === true;
    const premium = f?.any_premium === true;
    const locked = f?.any_locked === true;
    const axis = axisOf(f?.axis_kind ?? null);
    const coinCost = premium ? toInt(f?.min_premium_cost) : 0;
    const kind = labelNodeKind({ isEnding, isBranchPoint, premium, locked, axis });
    return {
      id: String(b.id),
      kind,
      episodeId: String(b.episode_id),
      beatIndex: toInt(b.beat_index),
      role: String(b.role ?? ""),
      isBranchPoint,
      isEnding,
      premium,
      locked,
      coinCost,
      axis,
    };
  });

  const edges: GraphEdge[] = edgeRows.map((e) => {
    const choice = edgeChoiceLabel(e.condition);
    return {
      from: String(e.from_beat_id),
      to: String(e.to_beat_id),
      choice,
      isDefault: choice == null,
    };
  });

  // memoryVars: the hosted schema has no dedicated story-graph memory table, so we return an empty list
  // plus a TODO rather than fabricating variables. A followup wires a real memory-variable source.
  const memoryVars: MemoryVar[] = [];

  const pricing = nodes
    .filter((n) => n.premium && n.coinCost > 0)
    .map((n) => ({ nodeId: n.id, kind: n.kind, coinCost: n.coinCost }));

  return {
    seriesId,
    nodes,
    edges,
    memoryVars,
    memoryVarsTodo:
      "memory variables are not modeled in the hosted schema yet; wire a real story-graph memory source",
    pricing,
    canon: checkCanon({ nodes, edges }),
  };
}

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/analytics : creator analytics aggregated from engagement_events + decision_log +
// coin_transactions.
//
//   - beatRetention: per-beat play vs swipe-away (beat_started vs beat_skipped) -> retention 0..1.
//   - branchPerformance: off-policy lift per branch beat as a BAND {low,high,center} (NEVER a point),
//     derived with liftBand (bands.ts) from decision_log treatment/control reward outcomes.
//   - endingDistribution: share of episode_completed events per reached ending beat.
//   - funnel: impression -> play -> completion_50 -> episode_completed -> unlock_purchased for the series.
//   - completion + watchTime: completion rate (completion_50 / play) and total watch ms.
//   - byCohort: the funnel headline counts sliced by viewer_state.cohort_id.
//
// Reads engagement_events / decision_log / coin_transactions ONLY (content/ad firewall + reward-weights
// gate: this never reads or returns a reward weight). All unqualified so search_path=mobile resolves the
// overlay. Read-only.
// ---------------------------------------------------------------------------------------------------

// Per-beat retention raw counts: beat_started ("played") vs beat_skipped ("swiped away") for the series.
// Grouped per beat. The mapper turns these into a retention fraction with an honest 0 when nothing played.
export function buildBeatRetentionQuery(seriesId: string): SqlSpec {
  return {
    text: `select e.beat_id as beat_id,
            count(*) filter (where e.type = 'beat_started')::int as started,
            count(*) filter (where e.type = 'beat_skipped')::int as skipped
       from engagement_events e
      where e.series_id = $1
        and e.beat_id is not null
        and e.type in ('beat_started', 'beat_skipped')
      group by e.beat_id`,
    values: [seriesId],
  };
}

export interface BeatRetention {
  beatId: string;
  // 0..1 share of beat_started that did NOT swipe away. started 0 -> retention 0 (no evidence), not NaN.
  retention: number;
  started: number;
  skipped: number;
}

export function mapBeatRetention(rows: Array<Record<string, unknown>>): BeatRetention[] {
  return rows.map((r) => {
    const started = toInt(r.started);
    const skipped = toInt(r.skipped);
    const retention = started > 0 ? Math.max(0, Math.min(1, (started - skipped) / started)) : 0;
    return { beatId: String(r.beat_id), retention, started, skipped };
  });
}

// Per-branch treatment/control outcome counts from decision_log for the series' beats. A row is a
// "success" when the served decision earned a positive reward (reward ->> 'value' > 0, tolerant of the
// jsonb reward shape). Joined through beats so only this series' branch beats are aggregated. The lift
// BAND is derived in the mapper (bands.ts), never as a point.
export function buildBranchPerformanceQuery(seriesId: string): SqlSpec {
  return {
    text: `select d.beat_id as beat_id,
            count(*) filter (where coalesce(d.is_control, false) = false)::int as treatment_trials,
            count(*) filter (
              where coalesce(d.is_control, false) = false
                and coalesce((d.reward ->> 'value')::float, 0) > 0
            )::int as treatment_success,
            count(*) filter (where coalesce(d.is_control, false) = true)::int as control_trials,
            count(*) filter (
              where coalesce(d.is_control, false) = true
                and coalesce((d.reward ->> 'value')::float, 0) > 0
            )::int as control_success
       from decision_log d
       join beats b on b.id = d.beat_id
      where b.series_id = $1
      group by d.beat_id
      order by treatment_trials desc`,
    values: [seriesId],
  };
}

export interface BranchPerformance {
  branchId: string;
  treatmentTrials: number;
  controlTrials: number;
  // The off-policy lift as a BAND, never a point. inconclusive when the band straddles zero.
  lift: Band;
  inconclusive: boolean;
  direction: "up" | "down" | "none";
}

export function mapBranchPerformance(rows: Array<Record<string, unknown>>): BranchPerformance[] {
  return rows.map((r) => {
    const verdict: BandVerdict = liftBand(
      toInt(r.treatment_success),
      toInt(r.treatment_trials),
      toInt(r.control_success),
      toInt(r.control_trials),
    );
    return {
      branchId: String(r.beat_id),
      treatmentTrials: toInt(r.treatment_trials),
      controlTrials: toInt(r.control_trials),
      lift: verdict.band,
      inconclusive: verdict.inconclusive,
      direction: verdict.direction,
    };
  });
}

// Ending distribution: count episode_completed events landing on each ending beat for the series. We join
// engagement_events.beat_id to ending-flagged beats (role='ending' OR a variant flagged is_ending) so only
// terminal beats are counted. The mapper turns counts into shares.
export function buildEndingDistributionQuery(seriesId: string): SqlSpec {
  return {
    text: `select e.beat_id as beat_id, count(*)::int as completions
       from engagement_events e
       join beats b on b.id = e.beat_id and b.series_id = $1
      where e.type = 'episode_completed'
        and e.beat_id is not null
        and (
          b.role = 'ending'
          or exists (
            select 1 from beat_variants v
             where v.beat_id = b.id and coalesce(v.is_ending, false) = true
          )
        )
      group by e.beat_id
      order by completions desc`,
    values: [seriesId],
  };
}

export interface EndingShare {
  beatId: string;
  completions: number;
  // 0..1 share of all ending completions that landed here.
  share: number;
}

export function mapEndingDistribution(rows: Array<Record<string, unknown>>): EndingShare[] {
  const counts = rows.map((r) => ({ beatId: String(r.beat_id), completions: toInt(r.completions) }));
  const total = counts.reduce((acc, c) => acc + c.completions, 0);
  return counts.map((c) => ({
    beatId: c.beatId,
    completions: c.completions,
    share: total > 0 ? c.completions / total : 0,
  }));
}

// Series funnel headline counts in one pass over engagement_events for the series. Stages mirror the
// documented funnel restricted to the player-facing ones the studio cares about per series.
export const SERIES_FUNNEL_STAGES = [
  "impression",
  "play",
  "completion_50",
  "episode_completed",
  "unlock_purchased",
] as const;

export function buildSeriesFunnelQuery(seriesId: string): SqlSpec {
  return {
    text: `select
            count(*) filter (where type = 'impression')::int as impression,
            count(*) filter (where type = 'play')::int as play,
            count(*) filter (where type = 'completion_50')::int as completion_50,
            count(*) filter (where type = 'episode_completed')::int as episode_completed,
            count(*) filter (where type = 'unlock_purchased')::int as unlock_purchased
       from engagement_events
      where series_id = $1`,
    values: [seriesId],
  };
}

export interface FunnelStage {
  stage: string;
  count: number;
  // Conversion from the PRIOR stage, 0..1. The first stage is the entry (rate 1). A zero prior is 0 (no
  // divide-by-zero), flagged honestly rather than NaN.
  conversionFromPrev: number;
}

export function deriveSeriesFunnel(counts: Record<string, unknown>): FunnelStage[] {
  const stages: FunnelStage[] = [];
  let prev = 0;
  SERIES_FUNNEL_STAGES.forEach((stage, i) => {
    const count = toInt(counts[stage]);
    const conversionFromPrev = i === 0 ? 1 : prev > 0 ? count / prev : 0;
    stages.push({ stage, count, conversionFromPrev });
    prev = count;
  });
  return stages;
}

// Completion + watch-time headline for the series. completion_50 / play is the completion rate (a 0..1
// fraction shown as the headline); total watch ms sums the session_ended total_ms payload (the only
// duration the event taxonomy carries). Both null-safe.
export function buildSeriesCompletionQuery(seriesId: string): SqlSpec {
  return {
    text: `select
            count(*) filter (where type = 'play')::int as plays,
            count(*) filter (where type = 'completion_50')::int as completions,
            coalesce(sum((payload ->> 'total_ms')::float) filter (where type = 'session_ended'), 0) as watch_ms
       from engagement_events
      where series_id = $1`,
    values: [seriesId],
  };
}

export interface CompletionSummary {
  completion: number;
  watchTimeMs: number;
}

export function mapCompletion(rows: Array<Record<string, unknown>>): CompletionSummary {
  const r = rows[0] ?? {};
  const plays = toInt(r.plays);
  const completions = toInt(r.completions);
  const completion = plays > 0 ? Math.max(0, Math.min(1, completions / plays)) : 0;
  const watchMs = typeof r.watch_ms === "number" ? r.watch_ms : Number(r.watch_ms);
  return { completion, watchTimeMs: Number.isFinite(watchMs) ? Math.max(0, watchMs) : 0 };
}

// Funnel headline counts sliced by viewer_state.cohort_id for the series. Joins engagement_events to the
// viewer's per-series cohort. Rows with no cohort are bucketed under 'unassigned' so the slice is total.
export function buildCohortFunnelQuery(seriesId: string): SqlSpec {
  return {
    text: `select coalesce(vs.cohort_id, 'unassigned') as cohort_id,
            count(*) filter (where e.type = 'play')::int as play,
            count(*) filter (where e.type = 'completion_50')::int as completion_50,
            count(*) filter (where e.type = 'episode_completed')::int as episode_completed
       from engagement_events e
       left join viewer_state vs on vs.user_id = e.user_id and vs.series_id = e.series_id
      where e.series_id = $1
      group by coalesce(vs.cohort_id, 'unassigned')
      order by play desc`,
    values: [seriesId],
  };
}

export interface CohortSlice {
  cohortId: string;
  play: number;
  completion50: number;
  episodeCompleted: number;
  // completion_50 / play for the cohort, 0..1 (no divide-by-zero).
  completion: number;
}

export function mapCohortSlices(rows: Array<Record<string, unknown>>): CohortSlice[] {
  return rows.map((r) => {
    const play = toInt(r.play);
    const completion50 = toInt(r.completion_50);
    return {
      cohortId: String(r.cohort_id ?? "unassigned"),
      play,
      completion50,
      episodeCompleted: toInt(r.episode_completed),
      completion: play > 0 ? Math.max(0, Math.min(1, completion50 / play)) : 0,
    };
  });
}

export interface SeriesAnalytics {
  seriesId: string;
  beatRetention: BeatRetention[];
  branchPerformance: BranchPerformance[];
  endingDistribution: EndingShare[];
  funnel: FunnelStage[];
  completion: number;
  watchTimeMs: number;
  byCohort: CohortSlice[];
}
