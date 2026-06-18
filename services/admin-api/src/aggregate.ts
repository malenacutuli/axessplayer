// Aggregation layer for the admin API. Runs the pure query builders (queries.ts) against a node-postgres
// query port and shapes the rows into the ADMIN API CONTRACT DTOs: the dashboard KPI cards + topSeries
// bands, the content entity tree, and a single-series detail. No SQL strings live here; this layer only
// orchestrates the builders and maps rows to view models. No em dashes.
//
// The query port is the minimal `Pick<pg.Pool, "query">` surface, so the real PgPool, a PGlite pool, or a
// fake pg in tests all satisfy it.

import type pg from "pg";
import {
  usersCountSql,
  engagementSql,
  decisionsSql,
  latestPolicyVersionSql,
  coinTotalsSql,
  coinByTypeSql,
  seriesInventorySql,
  variantInventorySql,
  topSeriesByEngagementSql,
  channelsSql,
  seriesChannelMapSql,
  seriesListSql,
  episodesListSql,
  variantRollupBySeriesSql,
  seriesByIdSql,
  episodesBySeriesSql,
  beatsBySeriesSql,
  variantsBySeriesSql,
  graphBeatsSql,
  graphVariantFlagsBySeriesSql,
  graphEdgesBySeriesSql,
  accessibilityCoverageSql,
  usersListSql,
  usersTotalSql,
  userByIdSql,
  userWalletSql,
  userEngagementCountSql,
  userCoinHistorySql,
  usersEngagementCountsSql,
  usersWalletBalancesSql,
  seriesOwnerColumnProbeSql,
  type Sql,
} from "./queries.js";
import {
  labelNodeKind,
  graphVersion,
  scoreReadiness,
  type StoryGraph,
  type GraphNode,
  type GraphEdge,
  type SeriesReadiness,
  type TrackCoverage,
} from "./storygraph.js";
import { revenueShare, CREATOR_SHARE, PLATFORM_SHARE, type RevenueSplit } from "./revenue.js";

export type QueryPort = Pick<pg.Pool, "query">;

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ---- Dashboard --------------------------------------------------------------------------------------

export interface Kpi {
  key: string;
  label: string;
  value: number;
  // A coarse trend hint. This wave computes no time-window deltas (a later slice adds the comparison
  // window), so trend is "flat" everywhere: honest about what is and is not measured, not faked.
  trend: "up" | "down" | "flat";
  // A route hint the console uses for drill-through. Stable client-side route, not a server path.
  drillTo: string;
}

export interface SeriesBand {
  id: string;
  title: string;
  events: number;
}

export interface Dashboard {
  kpis: Kpi[];
  topSeries: SeriesBand[];
  // DISPLAY-ONLY policy provenance. The currently-serving policy build, shown so an operator knows which
  // version produced the decisions. Reward weights are a founder sign-off and are NOT exposed here.
  policy: { version: string | null; rewardWeightsEditable: false };
}

export async function buildDashboard(db: QueryPort): Promise<Dashboard> {
  const [users, engagement, decisions, policy, coins, byType, series, variants, top] = await Promise.all([
    run<{ n: number }>(db, usersCountSql()),
    run<{ starts: number; completions: number; total: number }>(db, engagementSql()),
    run<{ total: number; control: number }>(db, decisionsSql()),
    run<{ policy_version: string }>(db, latestPolicyVersionSql()),
    run<{ transactions: number; credited: number; spent: number; purchased: number }>(db, coinTotalsSql()),
    run<{ type: string; count: number; coins: number }>(db, coinByTypeSql()),
    run<{ total: number; published: number }>(db, seriesInventorySql()),
    run<{ total: number; premium: number; qa_passed: number; with_captions: number; with_ad: number; with_sign: number; with_dub: number }>(db, variantInventorySql()),
    run<{ id: string; title: string; events: number }>(db, topSeriesByEngagementSql()),
  ]);

  const e = engagement[0] ?? { starts: 0, completions: 0, total: 0 };
  const d = decisions[0] ?? { total: 0, control: 0 };
  const c = coins[0] ?? { transactions: 0, credited: 0, spent: 0, purchased: 0 };
  const s = series[0] ?? { total: 0, published: 0 };
  const v = variants[0] ?? { total: 0, premium: 0, qa_passed: 0, with_captions: 0, with_ad: 0, with_sign: 0, with_dub: 0 };

  const a11yCovered = num(v.with_captions) + num(v.with_ad) + num(v.with_sign);
  const kpis: Kpi[] = [
    { key: "users", label: "Users", value: num(users[0]?.n), trend: "flat", drillTo: "/admin/users" },
    { key: "watch_starts", label: "Watch starts", value: num(e.starts), trend: "flat", drillTo: "/admin/analytics" },
    { key: "watch_completions", label: "Watch completions", value: num(e.completions), trend: "flat", drillTo: "/admin/analytics" },
    { key: "decisions", label: "Decisions served", value: num(d.total), trend: "flat", drillTo: "/admin/engine" },
    { key: "decisions_control", label: "Control decisions", value: num(d.control), trend: "flat", drillTo: "/admin/engine" },
    { key: "coins_purchased", label: "Coins purchased", value: num(c.purchased), trend: "flat", drillTo: "/admin/finance" },
    { key: "coins_credited", label: "Coins credited", value: num(c.credited), trend: "flat", drillTo: "/admin/finance" },
    { key: "coins_spent", label: "Coins spent", value: num(c.spent), trend: "flat", drillTo: "/admin/finance" },
    { key: "coin_transactions", label: "Coin transactions", value: num(c.transactions), trend: "flat", drillTo: "/admin/finance" },
    { key: "series_published", label: "Series published", value: num(s.published), trend: "flat", drillTo: "/admin/content" },
    { key: "series_total", label: "Series total", value: num(s.total), trend: "flat", drillTo: "/admin/content" },
    { key: "variants_total", label: "Variants", value: num(v.total), trend: "flat", drillTo: "/admin/content" },
    { key: "variants_a11y", label: "A11y tracks", value: a11yCovered, trend: "flat", drillTo: "/admin/content" },
  ];

  // Coin-by-type folds into the finance drill, not a top-line KPI card. Surfaced on the dashboard payload
  // so the finance band can render the breakdown without a second call.
  void byType;

  return {
    kpis,
    topSeries: top.map((r) => ({ id: r.id, title: r.title, events: num(r.events) })),
    policy: { version: policy[0]?.policy_version ?? null, rewardWeightsEditable: false },
    // Attach the by-type breakdown for the finance band.
    ...(byType.length > 0 ? { coinsByType: byType.map((r) => ({ type: r.type, count: num(r.count), coins: num(r.coins) })) } : {}),
  } as Dashboard & { coinsByType?: Array<{ type: string; count: number; coins: number }> };
}

// ---- Content tree -----------------------------------------------------------------------------------

export type ContentStatus = "draft" | "live";

export interface TreeEpisode {
  id: string;
  episodeNumber: number;
  title: string | null;
  status: ContentStatus;
}

export interface TreeSeries {
  id: string;
  title: string;
  genre: string | null;
  status: ContentStatus;
  episodes: TreeEpisode[];
  inventory: {
    variants: number;
    qaPassed: number;
    withCaptions: number;
    withAudioDescription: number;
    withSign: number;
  };
}

export interface TreeChannel {
  id: string;
  slug: string | null;
  name: string | null;
  series: TreeSeries[];
}

export interface ContentTree {
  channels: TreeChannel[];
  // Series not attached to any channel still need a home in the tree so nothing is a dead end.
  unassigned: TreeSeries[];
}

const statusOf = (publishedAt: unknown): ContentStatus => (publishedAt != null ? "live" : "draft");

export async function buildContentTree(db: QueryPort): Promise<ContentTree> {
  const [channels, map, series, episodes, rollup] = await Promise.all([
    run<{ id: string; slug: string | null; name: string | null }>(db, channelsSql()),
    run<{ series_id: string; channel_id: string }>(db, seriesChannelMapSql()),
    run<{ id: string; title: string; genre: string | null; published_at: unknown }>(db, seriesListSql()),
    run<{ id: string; series_id: string; episode_number: number; title: string | null; published_at: unknown }>(db, episodesListSql()),
    run<{ series_id: string; variants: number; qa_passed: number; with_captions: number; with_ad: number; with_sign: number }>(db, variantRollupBySeriesSql()),
  ]);

  const epsBySeries = new Map<string, TreeEpisode[]>();
  for (const e of episodes) {
    const list = epsBySeries.get(e.series_id) ?? [];
    list.push({ id: e.id, episodeNumber: num(e.episode_number), title: e.title, status: statusOf(e.published_at) });
    epsBySeries.set(e.series_id, list);
  }

  const rollupBySeries = new Map<string, TreeSeries["inventory"]>();
  for (const r of rollup) {
    rollupBySeries.set(r.series_id, {
      variants: num(r.variants),
      qaPassed: num(r.qa_passed),
      withCaptions: num(r.with_captions),
      withAudioDescription: num(r.with_ad),
      withSign: num(r.with_sign),
    });
  }

  const seriesById = new Map<string, TreeSeries>();
  for (const s of series) {
    seriesById.set(s.id, {
      id: s.id,
      title: s.title,
      genre: s.genre,
      status: statusOf(s.published_at),
      episodes: epsBySeries.get(s.id) ?? [],
      inventory: rollupBySeries.get(s.id) ?? { variants: 0, qaPassed: 0, withCaptions: 0, withAudioDescription: 0, withSign: 0 },
    });
  }

  const channelOf = new Map<string, string[]>(); // channelId -> seriesIds
  const assigned = new Set<string>();
  for (const m of map) {
    const list = channelOf.get(m.channel_id) ?? [];
    list.push(m.series_id);
    channelOf.set(m.channel_id, list);
    assigned.add(m.series_id);
  }

  const treeChannels: TreeChannel[] = channels.map((ch) => ({
    id: ch.id,
    slug: ch.slug,
    name: ch.name,
    series: (channelOf.get(ch.id) ?? []).map((sid) => seriesById.get(sid)).filter((x): x is TreeSeries => x != null),
  }));

  const unassigned = series.filter((s) => !assigned.has(s.id)).map((s) => seriesById.get(s.id)).filter((x): x is TreeSeries => x != null);

  return { channels: treeChannels, unassigned };
}

// ---- Content detail (a single series, full graph rollup) -------------------------------------------

export interface ContentDetailBeat {
  id: string;
  episodeId: string;
  beatIndex: number;
  role: string;
  isBranchPoint: boolean;
}

export interface ContentDetailVariant {
  id: string;
  beatId: string;
  language: string;
  tier: string;
  intensity: number;
  isPremium: boolean;
  qaStatus: string;
  hasCaptions: boolean;
  hasAudioDescription: boolean;
  hasSign: boolean;
}

export interface ContentDetail {
  id: string;
  title: string;
  genre: string | null;
  baseLanguage: string | null;
  availableLanguages: string[];
  status: ContentStatus;
  posterUrl: string | null;
  episodes: Array<{ id: string; episodeNumber: number; title: string | null; isFree: boolean; coinCost: number; status: ContentStatus }>;
  beats: ContentDetailBeat[];
  variants: ContentDetailVariant[];
}

export async function buildContentDetail(db: QueryPort, seriesId: string): Promise<ContentDetail | null> {
  const series = await run<{ id: string; title: string; genre: string | null; base_language: string | null; available_languages: string[] | null; published_at: unknown; poster_url: string | null }>(db, seriesByIdSql(seriesId));
  const s = series[0];
  if (s == null) return null;

  const [episodes, beats, variants] = await Promise.all([
    run<{ id: string; episode_number: number; title: string | null; is_free: boolean; coin_cost: number; published_at: unknown }>(db, episodesBySeriesSql(seriesId)),
    run<{ id: string; episode_id: string; beat_index: number; role: string; is_branch_point: boolean }>(db, beatsBySeriesSql(seriesId)),
    run<{ id: string; beat_id: string; language: string; tier: string; intensity: number; is_premium: boolean; qa_status: string; caption_doc_url: string | null; audio_description_url: string | null; sign_video_url: string | null }>(db, variantsBySeriesSql(seriesId)),
  ]);

  return {
    id: s.id,
    title: s.title,
    genre: s.genre,
    baseLanguage: s.base_language,
    availableLanguages: Array.isArray(s.available_languages) ? s.available_languages : [],
    status: statusOf(s.published_at),
    posterUrl: s.poster_url,
    episodes: episodes.map((e) => ({ id: e.id, episodeNumber: num(e.episode_number), title: e.title, isFree: Boolean(e.is_free), coinCost: num(e.coin_cost), status: statusOf(e.published_at) })),
    beats: beats.map((b) => ({ id: b.id, episodeId: b.episode_id, beatIndex: num(b.beat_index), role: b.role, isBranchPoint: Boolean(b.is_branch_point) })),
    variants: variants.map((vr) => ({
      id: vr.id,
      beatId: vr.beat_id,
      language: vr.language,
      tier: vr.tier,
      intensity: num(vr.intensity),
      isPremium: Boolean(vr.is_premium),
      qaStatus: vr.qa_status,
      hasCaptions: vr.caption_doc_url != null,
      hasAudioDescription: vr.audio_description_url != null,
      hasSign: vr.sign_video_url != null,
    })),
  };
}

// ---- Story graph (GET /admin/story-graph/:seriesId) ------------------------------------------------
//
// Compose the versioned graph JSON from the hosted content graph. Nodes are beats labeled by their flags
// and their variants' substrate flags (branch/ending/premium/pov/intensity). Edges are beat_edges, with a
// default-fallback flag derived from an empty/missing condition (the canon path). Pricing is the per-beat
// minimum premium coin_cost. memoryVars are read from beats.canon_facts when present (the only place the
// hosted schema carries declared story state), and otherwise an empty list with a TODO is returned rather
// than fabricating variables. Returns null when the series does not exist.

interface GraphBeatRow {
  id: string;
  episode_id: string;
  beat_index: number;
  role: string;
  is_branch_point: boolean;
}
interface GraphFlagRow {
  beat_id: string;
  any_premium: boolean | null;
  any_branch: boolean | null;
  any_ending: boolean | null;
  min_premium_cost: number | null;
  variant_kind: string | null;
}
interface GraphEdgeRow {
  from_beat_id: string;
  to_beat_id: string;
  condition: unknown;
}

// An edge is the canon default-fallback when its condition is null or an empty object. A populated
// condition is a guarded branch edge. The condition is reduced to a short display label.
function edgeConditionLabel(condition: unknown): string | null {
  if (condition == null) return null;
  if (typeof condition === "object") {
    const keys = Object.keys(condition as Record<string, unknown>);
    if (keys.length === 0) return null;
    return keys.join(",");
  }
  return String(condition);
}

// Map the substrate variant_kind to a node axis label. Only pov/intensity participate in the axis
// labeling; other kinds (dub, a11y, alt_ending, ...) do not change the node's graph kind here.
function axisOf(variantKind: string | null): string | null {
  if (variantKind === "pov") return "pov";
  if (variantKind === "intensity") return "intensity";
  return null;
}

export async function buildStoryGraph(db: QueryPort, seriesId: string): Promise<StoryGraph | null> {
  // Existence gate: reuse the series-by-id read so an unknown series is a clean null (the route maps it to
  // 404) rather than an empty-but-present graph.
  const series = await run<{ id: string }>(db, seriesByIdSql(seriesId));
  if (series[0] == null) return null;

  const [beats, flags, edges] = await Promise.all([
    run<GraphBeatRow>(db, graphBeatsSql(seriesId)),
    run<GraphFlagRow>(db, graphVariantFlagsBySeriesSql(seriesId)),
    run<GraphEdgeRow>(db, graphEdgesBySeriesSql(seriesId)),
  ]);

  const flagByBeat = new Map<string, GraphFlagRow>();
  for (const f of flags) flagByBeat.set(f.beat_id, f);

  const nodes: GraphNode[] = beats.map((b) => {
    const f = flagByBeat.get(b.id);
    const isEnding = Boolean(f?.any_ending) || b.role === "ending";
    const isBranchPoint = Boolean(b.is_branch_point) || Boolean(f?.any_branch);
    const locked = Boolean(f?.any_premium);
    const axis = axisOf(f?.variant_kind ?? null);
    const coinCost = locked ? num(f?.min_premium_cost) : 0;
    const kind = labelNodeKind({ isEnding, isBranchPoint, locked, axis });
    return {
      id: b.id,
      kind,
      episodeId: b.episode_id,
      beatIndex: num(b.beat_index),
      role: b.role,
      isBranchPoint,
      isEnding,
      locked,
      coinCost,
      axis,
    };
  });

  const graphEdges: GraphEdge[] = edges.map((e) => {
    const label = edgeConditionLabel(e.condition);
    return { from: e.from_beat_id, to: e.to_beat_id, isDefault: label == null, condition: label };
  });

  // memoryVars: derive declared variable names from beats.canon_facts keys when that column carries any.
  // The hosted schema has no dedicated story-graph memory table yet, so when nothing is found we return an
  // empty list plus a TODO rather than inventing variables. canon_facts is not selected by graphBeatsSql
  // (it can be large); this wave does not read it, so memoryVars is empty with a TODO and a followup wires
  // a real memory-variable source.
  const memoryVars = [] as StoryGraph["memoryVars"];

  const pricing = nodes
    .filter((n) => n.locked && n.coinCost > 0)
    .map((n) => ({ nodeId: n.id, kind: n.kind, coinCost: n.coinCost }));

  return {
    seriesId,
    version: graphVersion(nodes, graphEdges),
    nodes,
    edges: graphEdges,
    memoryVars,
    pricing,
    memoryVarsTodo:
      "memory variables are not modeled in the hosted schema yet; wire the prompt-02 storygraph memoryVars source",
  };
}

// ---- Media factory jobs (GET /admin/media-factory/jobs) --------------------------------------------
//
// Read produce-DAG job state IF a jobs table/structure exists. The hosted schema has NO media-factory
// jobs table (the prompt-13 orchestrator state is not yet persisted), so this returns an empty list with
// a clear, stable shape and a `source: "unwired"` marker so the console renders a real empty state rather
// than fabricating jobs. The route attaches a followup to wire the orchestrator state.

export interface MediaFactoryJobStage {
  name: string;
  status: "pending" | "running" | "succeeded" | "failed";
  cost: number;
  assetId: string | null;
}
export interface MediaFactoryJob {
  jobId: string;
  seriesId: string;
  stages: MediaFactoryJobStage[];
  state: "queued" | "running" | "succeeded" | "failed";
}
export interface MediaFactoryJobs {
  jobs: MediaFactoryJob[];
  // "unwired" until the prompt-13 orchestrator state is persisted and read here. No fabricated jobs.
  source: "unwired" | "hosted";
  note: string;
}

export async function buildMediaFactoryJobs(_db: QueryPort): Promise<MediaFactoryJobs> {
  // No jobs table exists in the hosted schema or the additive scripts, so there is nothing to read. Return
  // the empty-but-typed shape; do NOT invent jobs. _db is accepted so the signature is stable once a real
  // jobs read is wired.
  void _db;
  return {
    jobs: [],
    source: "unwired",
    note: "produce-DAG job state is not persisted yet; wire the prompt-13 media-factory orchestrator state",
  };
}

// ---- Accessibility readiness (GET /admin/accessibility) --------------------------------------------
//
// Per-series readiness from track presence (cc/ad/sign/dub coverage as a 0..100 score + blockers),
// per-track QA placeholders, and a review-queue read. There is no review-queue table in the hosted schema
// yet, so the queue is empty with a `source: "unwired"` marker and a followup, never fabricated.

export interface AccessibilityReport {
  readiness: SeriesReadiness[];
  // Per-track QA rollup placeholders. The four tracks with their summed coverage across all series, so the
  // console can render per-track meters. QA pass/fail per track is a later slice (flagged, not faked).
  perTrack: Array<{ track: "cc" | "ad" | "sign" | "dub"; covered: number; total: number; qaNote: string }>;
  reviewQueue: Array<{ seriesId: string; track: string; reason: string }>;
  reviewQueueSource: "unwired" | "hosted";
  reviewQueueNote: string;
}

interface CoverageRow {
  series_id: string;
  total: number;
  with_captions: number;
  with_ad: number;
  with_sign: number;
  with_dub: number;
}

export async function buildAccessibility(db: QueryPort): Promise<AccessibilityReport> {
  const [coverage, seriesRows] = await Promise.all([
    run<CoverageRow>(db, accessibilityCoverageSql()),
    run<{ id: string; title: string }>(db, seriesListSql()),
  ]);

  const titleById = new Map<string, string>();
  for (const s of seriesRows) titleById.set(s.id, s.title);

  const readiness: SeriesReadiness[] = coverage.map((c) => {
    const cov: TrackCoverage = {
      total: num(c.total),
      withCaptions: num(c.with_captions),
      withAudioDescription: num(c.with_ad),
      withSign: num(c.with_sign),
      withDub: num(c.with_dub),
    };
    return scoreReadiness(c.series_id, titleById.get(c.series_id) ?? null, cov);
  });

  // Per-track totals summed across every series, for the global per-track meters.
  let total = 0;
  let cc = 0;
  let ad = 0;
  let sign = 0;
  let dub = 0;
  for (const c of coverage) {
    total += num(c.total);
    cc += num(c.with_captions);
    ad += num(c.with_ad);
    sign += num(c.with_sign);
    dub += num(c.with_dub);
  }
  const perTrack: AccessibilityReport["perTrack"] = [
    { track: "cc", covered: cc, total, qaNote: "coverage only; per-track QA verdicts are a later slice" },
    { track: "ad", covered: ad, total, qaNote: "coverage only; per-track QA verdicts are a later slice" },
    { track: "sign", covered: sign, total, qaNote: "coverage only; per-track QA verdicts are a later slice" },
    { track: "dub", covered: dub, total, qaNote: "coverage only; per-track QA verdicts are a later slice" },
  ];

  return {
    readiness,
    perTrack,
    reviewQueue: [],
    reviewQueueSource: "unwired",
    reviewQueueNote: "no accessibility review-queue table in the hosted schema yet; wire the QA review queue read",
  };
}

// ---- Brands / Campaigns / Placements (sections 7-8, GET /admin/brands|campaigns|placements) ----------
//
// The AD PLANE. The hosted schema has NO brand/campaign/placement tables yet (prompt 19 lands them). These
// return REAL EMPTY arrays with a typed shape and source:"unwired" plus a note, so the console renders a
// real empty state. We do NOT fabricate rows. CONTENT/AD FIREWALL: there is deliberately no DB read here at
// all this wave, and when prompt-19 wires these, the reads must stay on the brand/campaign/placement tables
// and NEVER join content-ranking or decision tables. The shapes below are the contract the console codes
// against now so wiring prompt-19 is a data swap, not a shape change.

export interface BrandRow {
  id: string;
  name: string;
  status: string;
}
export interface CampaignRow {
  id: string;
  brandId: string;
  name: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}
export interface PlacementRow {
  id: string;
  campaignId: string;
  slot: string;
  status: string;
}

export interface UnwiredList<T> {
  items: T[];
  source: "unwired" | "hosted";
  note: string;
}

const PROMPT19_NOTE =
  "brand/campaign/placement tables are not in the hosted schema yet; wire the prompt-19 ad-plane tables (firewalled from content ranking)";

// All three accept the db port so the signature is stable once prompt-19 wires a firewalled read, but they
// do NOT query this wave: there is no table to read, and issuing a query would risk touching the wrong
// surface. Empty + unwired is the honest answer.
export async function buildBrands(_db: QueryPort): Promise<UnwiredList<BrandRow>> {
  void _db;
  return { items: [], source: "unwired", note: PROMPT19_NOTE };
}
export async function buildCampaigns(_db: QueryPort): Promise<UnwiredList<CampaignRow>> {
  void _db;
  return { items: [], source: "unwired", note: PROMPT19_NOTE };
}
export async function buildPlacements(_db: QueryPort): Promise<UnwiredList<PlacementRow>> {
  void _db;
  return { items: [], source: "unwired", note: PROMPT19_NOTE };
}

// ---- Users (section 8, GET /admin/users + /admin/users/:id) -----------------------------------------
//
// PRIVACY-MINIMIZED viewer admin. The list returns only id/username/tier/created_at plus a wallet balance
// and an engagement-event count per user (history as COUNTS, not raw rows). The detail adds the coin
// history rollup (transaction count, net credited/spent). No raw email/auth_id/avatar leaves this layer.
// The route logs the access via the audit sink as a read where required.

export interface UserListItem {
  id: string;
  username: string | null;
  tier: string;
  createdAt: string | null;
  walletBalance: number;
  bonusBalance: number;
  engagementEvents: number;
}
export interface UsersPage {
  users: UserListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface UserRow {
  id: string;
  username: string | null;
  tier: string | null;
  created_at: unknown;
}

const isoOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

export async function buildUsersPage(db: QueryPort, limit = 50, offset = 0): Promise<UsersPage> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  const safeOffset = Math.max(0, Math.floor(offset));
  const [rows, totalRows, balances, eventCounts] = await Promise.all([
    run<UserRow>(db, usersListSql(safeLimit, safeOffset)),
    run<{ n: number }>(db, usersTotalSql()),
    run<{ user_id: string; balance: number; bonus_balance: number }>(db, usersWalletBalancesSql()),
    run<{ user_id: string; events: number }>(db, usersEngagementCountsSql()),
  ]);

  const balanceByUser = new Map<string, { balance: number; bonus: number }>();
  for (const b of balances) balanceByUser.set(b.user_id, { balance: num(b.balance), bonus: num(b.bonus_balance) });
  const eventsByUser = new Map<string, number>();
  for (const e of eventCounts) eventsByUser.set(e.user_id, num(e.events));

  const users: UserListItem[] = rows.map((r) => {
    const wallet = balanceByUser.get(r.id) ?? { balance: 0, bonus: 0 };
    return {
      id: r.id,
      username: r.username,
      tier: r.tier ?? "free",
      createdAt: isoOrNull(r.created_at),
      walletBalance: wallet.balance,
      bonusBalance: wallet.bonus,
      engagementEvents: eventsByUser.get(r.id) ?? 0,
    };
  });

  return { users, total: num(totalRows[0]?.n), limit: safeLimit, offset: safeOffset };
}

export interface UserDetail {
  id: string;
  username: string | null;
  tier: string;
  createdAt: string | null;
  wallet: { balance: number; bonusBalance: number };
  history: {
    engagementEvents: number;
    coinTransactions: number;
    coinsCredited: number;
    coinsSpent: number;
    // The history is intentionally COUNTS/sums only. Raw events and individual receipts are not exposed:
    // an operator answering support questions needs the rollup, not the per-row PII.
    note: string;
  };
}

export async function buildUserDetail(db: QueryPort, userId: string): Promise<UserDetail | null> {
  const userRows = await run<UserRow>(db, userByIdSql(userId));
  const u = userRows[0];
  if (u == null) return null;

  const [wallet, events, coins] = await Promise.all([
    run<{ balance: number; bonus_balance: number }>(db, userWalletSql(userId)),
    run<{ events: number }>(db, userEngagementCountSql(userId)),
    run<{ transactions: number; credited: number; spent: number }>(db, userCoinHistorySql(userId)),
  ]);

  const w = wallet[0] ?? { balance: 0, bonus_balance: 0 };
  const c = coins[0] ?? { transactions: 0, credited: 0, spent: 0 };

  return {
    id: u.id,
    username: u.username,
    tier: u.tier ?? "free",
    createdAt: isoOrNull(u.created_at),
    wallet: { balance: num(w.balance), bonusBalance: num(w.bonus_balance) },
    history: {
      engagementEvents: num(events[0]?.events),
      coinTransactions: num(c.transactions),
      coinsCredited: num(c.credited),
      coinsSpent: num(c.spent),
      note: "history is privacy-minimized: counts and net sums only, no raw events or receipts",
    },
  };
}

// ---- Creators (section 9, GET /admin/creators + /admin/creators/:id) --------------------------------
//
// There is NO creators table and NO series-ownership column in the hosted schema. The creator view is
// DERIVED from series ownership IF a series.owner_id/creator_id column exists; otherwise it is empty +
// source:"unwired" with a followup. We probe the catalog (information_schema) before deriving so we never
// fabricate creators. The 70/30 split is computed by the pure revenueShare helper (revenue.ts), surfaced
// here display-only: no payout is executed. gross is 0 in the unwired case (no revenue source wired yet).

export interface CreatorRow {
  id: string;
  seriesCount: number;
  // Display-only revenue split. gross is the creator's attributable gross (0 until a revenue source is
  // wired); split shows what the 70/30 payout WOULD be. No payout is executed this wave.
  gross: number;
  split: RevenueSplit;
}
export interface CreatorsView {
  creators: CreatorRow[];
  source: "unwired" | "derived";
  // The split policy, surfaced so the console can label the 70/30 without re-deriving it.
  sharePolicy: { creator: number; platform: number };
  note: string;
}

const CREATOR_UNWIRED_NOTE =
  "no creators table and no series.owner_id/creator_id column in the hosted schema; wire a creator-ownership source (prompt 19+) before deriving creators";

export async function buildCreators(db: QueryPort): Promise<CreatorsView> {
  const probe = await run<{ column_name: string }>(db, seriesOwnerColumnProbeSql());
  // No ownership column -> nothing to derive. Empty + unwired, never fabricated.
  if (probe.length === 0) {
    return {
      creators: [],
      source: "unwired",
      sharePolicy: { creator: CREATOR_SHARE, platform: PLATFORM_SHARE },
      note: CREATOR_UNWIRED_NOTE,
    };
  }
  // If a column existed, a derive would run here. The hosted schema has none, so this branch is dormant;
  // it is structured so wiring an ownership column is a query swap, not a shape change. We still return the
  // display-only split policy. revenueShare is referenced so the split helper is the single source of truth.
  void revenueShare;
  return {
    creators: [],
    source: "derived",
    sharePolicy: { creator: CREATOR_SHARE, platform: PLATFORM_SHARE },
    note: "series-ownership column detected; creator derivation wiring is pending the ownership-source slice",
  };
}

export async function buildCreatorDetail(db: QueryPort, creatorId: string): Promise<CreatorRow | null> {
  // No ownership source -> no creator can be resolved. Returns null (the route maps it to 404) rather than
  // a fabricated creator. creatorId is accepted so the signature is stable once a source is wired.
  void creatorId;
  const probe = await run<{ column_name: string }>(db, seriesOwnerColumnProbeSql());
  if (probe.length === 0) return null;
  return null;
}
