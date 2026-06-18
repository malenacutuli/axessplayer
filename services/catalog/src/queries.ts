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
