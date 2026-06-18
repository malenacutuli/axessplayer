// Analytics aggregation for GET /admin/analytics?dim=. Folds the canonical event-taxonomy counts
// (queries.ts) into the requested dimension's DTO. The default dimension is the documented funnel
// impression -> play -> view_3s -> completion_50 -> episode_completed -> unlock. Counterfactual / branch
// LIFT is returned as a band {low,high,center}, NEVER a point (bands.ts). Pure-ish: every builder takes the
// minimal query port and delegates SQL to queries.ts; the band math is the pure bands.ts. No em dashes.
//
// HARD GATE: reward weights never appear here. Analytics reads engagement_events / decision_log /
// coin_transactions only; it never reads, returns, or lets an operator edit a reward weight.

import type { QueryPort } from "./aggregate.js";
import {
  funnelCountsSql,
  funnelBySeriesSql,
  funnelByEpisodeSql,
  a11yUsageSql,
  branchOutcomesSql,
  retentionByDaySql,
  type Sql,
} from "./queries.js";
import { liftBand, type Band, type BandVerdict } from "./bands.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// The dimensions the endpoint supports. "funnel" is the default. Unknown dims fall back to funnel with a
// note rather than erroring, so the console never hits a dead end.
export type AnalyticsDim = "funnel" | "series" | "episode" | "a11y" | "language" | "branch" | "retention";

const KNOWN_DIMS: readonly AnalyticsDim[] = ["funnel", "series", "episode", "a11y", "language", "branch", "retention"];

export function parseDim(raw: string | undefined): AnalyticsDim {
  if (raw != null && (KNOWN_DIMS as readonly string[]).includes(raw)) return raw as AnalyticsDim;
  return "funnel";
}

// ---- Funnel -----------------------------------------------------------------------------------------

export interface FunnelStage {
  stage: string;
  count: number;
  // Conversion from the PRIOR stage, 0..1. The first stage is the entry (rate 1 by definition). A stage
  // with a zero prior is 0 (no division by zero), flagged honestly rather than NaN.
  conversionFromPrev: number;
}

export interface FunnelResult {
  dim: "funnel";
  stages: FunnelStage[];
  note: string;
}

// The canonical stage order. Mirrors the documented default funnel and the funnelCountsSql column order.
const FUNNEL_STAGES = ["impression", "play", "view_3s", "completion_50", "episode_completed", "unlock"] as const;

export function deriveFunnel(counts: Record<string, number>): FunnelStage[] {
  const stages: FunnelStage[] = [];
  let prev = 0;
  FUNNEL_STAGES.forEach((stage, i) => {
    const count = num(counts[stage]);
    const conversionFromPrev = i === 0 ? 1 : prev > 0 ? count / prev : 0;
    stages.push({ stage, count, conversionFromPrev });
    prev = count;
  });
  return stages;
}

export async function buildFunnel(db: QueryPort): Promise<FunnelResult> {
  const rows = await run<Record<string, number>>(db, funnelCountsSql());
  const counts = rows[0] ?? {};
  return {
    dim: "funnel",
    stages: deriveFunnel(counts),
    note: "event counts per stage (not distinct sessions); distinct-session funnels are a later refinement",
  };
}

// ---- By series / episode --------------------------------------------------------------------------

export interface SeriesFunnelRow {
  seriesId: string;
  title: string | null;
  stages: FunnelStage[];
}
export interface SeriesFunnelResult {
  dim: "series";
  series: SeriesFunnelRow[];
}

export async function buildSeriesFunnel(db: QueryPort): Promise<SeriesFunnelResult> {
  const rows = await run<{ series_id: string; title: string | null } & Record<string, number>>(db, funnelBySeriesSql());
  return {
    dim: "series",
    series: rows.map((r) => ({ seriesId: r.series_id, title: r.title ?? null, stages: deriveFunnel(r) })),
  };
}

export interface EpisodeFunnelRow {
  episodeId: string;
  play: number;
  completion50: number;
  episodeCompleted: number;
}
export interface EpisodeFunnelResult {
  dim: "episode";
  episodes: EpisodeFunnelRow[];
}

export async function buildEpisodeFunnel(db: QueryPort): Promise<EpisodeFunnelResult> {
  const rows = await run<{ episode_id: string; play: number; completion_50: number; episode_completed: number }>(db, funnelByEpisodeSql());
  return {
    dim: "episode",
    episodes: rows.map((r) => ({
      episodeId: r.episode_id,
      play: num(r.play),
      completion50: num(r.completion_50),
      episodeCompleted: num(r.episode_completed),
    })),
  };
}

// ---- Accessibility / language usage ---------------------------------------------------------------

export interface A11yUsageResult {
  dim: "a11y" | "language";
  usage: { caption: number; audioDescription: number; sign: number; language: number };
  note: string;
}

export async function buildA11yUsage(db: QueryPort, dim: "a11y" | "language"): Promise<A11yUsageResult> {
  const rows = await run<{ caption: number; audio_description: number; sign: number; language: number }>(db, a11yUsageSql());
  const u = rows[0] ?? { caption: 0, audio_description: 0, sign: 0, language: 0 };
  return {
    dim,
    usage: { caption: num(u.caption), audioDescription: num(u.audio_description), sign: num(u.sign), language: num(u.language) },
    note: "toggle-event counts (track/language actually used), not unique users",
  };
}

// ---- Branch lift (COUNTERFACTUAL AS A BAND, never a point) ------------------------------------------

export interface BranchLiftRow {
  beatId: string;
  treatmentTrials: number;
  controlTrials: number;
  // The lift band of treatment-vs-control success rate. ALWAYS a band; the verdict says whether it is
  // inconclusive (the band straddles zero), so the console renders a LiftBand, never a point claim.
  lift: Band;
  inconclusive: boolean;
  direction: "up" | "down" | "none";
}
export interface BranchLiftResult {
  dim: "branch";
  branches: BranchLiftRow[];
  note: string;
}

interface BranchOutcomeRow {
  beat_id: string;
  treatment_trials: number;
  treatment_success: number;
  control_trials: number;
  control_success: number;
}

// Fold raw treatment/control outcome counts into a per-beat lift band. The band derivation is the pure
// liftBand (bands.ts): it combines each arm's binomial rate band, so a sparse beat gets a wide,
// inconclusive band and never a confident point.
export function deriveBranchLift(rows: BranchOutcomeRow[]): BranchLiftRow[] {
  return rows.map((r) => {
    const verdict: BandVerdict = liftBand(
      num(r.treatment_success),
      num(r.treatment_trials),
      num(r.control_success),
      num(r.control_trials),
    );
    return {
      beatId: r.beat_id,
      treatmentTrials: num(r.treatment_trials),
      controlTrials: num(r.control_trials),
      lift: verdict.band,
      inconclusive: verdict.inconclusive,
      direction: verdict.direction,
    };
  });
}

export async function buildBranchLift(db: QueryPort): Promise<BranchLiftResult> {
  const rows = await run<BranchOutcomeRow>(db, branchOutcomesSql());
  return {
    dim: "branch",
    branches: deriveBranchLift(rows),
    note: "branch lift is a counterfactual estimate shown as a band {low,high,center}; an inconclusive band straddles zero and is never a point claim",
  };
}

// ---- Retention --------------------------------------------------------------------------------------

export interface RetentionResult {
  dim: "retention";
  curve: Array<{ dayOffset: number; users: number; retentionRate: number }>;
  note: string;
}

interface RetentionRow {
  day_offset: number;
  users: number;
}

// Fold day-offset distinct-user counts into a retention curve. Day 0 is the cohort base; each later day's
// rate is users / day0Users (0 when the base is empty, never NaN).
export function deriveRetention(rows: RetentionRow[]): RetentionResult["curve"] {
  const day0 = rows.find((r) => num(r.day_offset) === 0);
  const base = day0 ? num(day0.users) : 0;
  return rows
    .map((r) => ({ dayOffset: num(r.day_offset), users: num(r.users), retentionRate: base > 0 ? num(r.users) / base : 0 }))
    .sort((a, b) => a.dayOffset - b.dayOffset);
}

export async function buildRetention(db: QueryPort): Promise<RetentionResult> {
  const rows = await run<RetentionRow>(db, retentionByDaySql());
  return {
    dim: "retention",
    curve: deriveRetention(rows),
    note: "trailing-window distinct users by day offset from first seen; cohort tables are a later refinement",
  };
}

// ---- Dispatch ---------------------------------------------------------------------------------------

export type AnalyticsResult =
  | FunnelResult
  | SeriesFunnelResult
  | EpisodeFunnelResult
  | A11yUsageResult
  | BranchLiftResult
  | RetentionResult;

export async function buildAnalytics(db: QueryPort, dim: AnalyticsDim): Promise<AnalyticsResult> {
  switch (dim) {
    case "series":
      return buildSeriesFunnel(db);
    case "episode":
      return buildEpisodeFunnel(db);
    case "a11y":
      return buildA11yUsage(db, "a11y");
    case "language":
      return buildA11yUsage(db, "language");
    case "branch":
      return buildBranchLift(db);
    case "retention":
      return buildRetention(db);
    case "funnel":
    default:
      return buildFunnel(db);
  }
}
