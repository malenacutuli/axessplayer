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
  type Sql,
} from "./queries.js";

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
