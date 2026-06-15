// The viewer preference vector: a fixed-length, NAMED, explainable feature vector. Named-first so a
// decision can be reconstructed and the EU AI Act inspectability bar (config EXPLAINABILITY_TOP_N) is
// satisfiable. Per W3_DECISION_DESIGN.md section 1. No em dashes.
//
// viewer_state.preference_vector (JSONB) is the system of record for this vector; the hot serving copy
// lives in KV (see kv.ts). This module owns the names, the cold-start cohort seed, and the EMA update.

import { EMA_ALPHA } from "./config.js";

// The named features, in a fixed order. Adding a feature is an explicit, reviewed change (the order is
// the contract between the stored vector and the bandit's linear algebra).
export const FEATURE_NAMES = [
  "completion_rate", // rolling completion rate, [0,1]
  "avg_dwell", // average dwell, normalized to [0,1]
  "replay_rate", // replays per beat, normalized to [0,1]
  "skip_rate", // fraction of beats skipped, [0,1]
  "intensity_ema", // chosen-intensity EMA, normalized 1..5 -> [0,1]
  "pace_ema", // chosen-pace EMA, [0,1]
  "time_of_day", // time-of-day bucket, [0,1]
  "device_class", // device class encoded to [0,1]
  "language_match", // 1 if content language matches preferred, else 0
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_DIM = FEATURE_NAMES.length;

// The vector as stored in viewer_state.preference_vector. A plain named map keeps it explainable in the
// database; toArray fixes the order for the bandit.
export type PreferenceVector = Record<FeatureName, number>;

export function zeroVector(): PreferenceVector {
  const v = {} as PreferenceVector;
  for (const name of FEATURE_NAMES) v[name] = 0;
  return v;
}

// Fix the named map into the canonical ordered array the bandit's matrices expect.
export function toArray(v: PreferenceVector): number[] {
  return FEATURE_NAMES.map((name) => v[name] ?? 0);
}

// Cold start: seed a new viewer from their cohort's mean vector. The interactive cold-open then
// calibrates this inside the first 60 seconds (design 1). Cohort means are a clear interface; the
// population-cohort source is a fake here (see CohortSeeds) and is flagged as such.
export interface CohortSeeds {
  meanVectorFor(cohortId: string | null): Promise<PreferenceVector>;
}

// In-memory cohort seed source. FAKE for this cut: returns a neutral mid-population prior. A real
// implementation reads cohort means computed offline from logged populations.
export class InMemoryCohortSeeds implements CohortSeeds {
  private readonly seeds: Map<string, PreferenceVector>;
  constructor(seeds: Record<string, PreferenceVector> = {}) {
    this.seeds = new Map(Object.entries(seeds));
  }
  async meanVectorFor(cohortId: string | null): Promise<PreferenceVector> {
    if (cohortId && this.seeds.has(cohortId)) return { ...this.seeds.get(cohortId)! };
    // Neutral mid-population prior so a brand-new viewer is not pinned to either extreme.
    const v = zeroVector();
    for (const name of FEATURE_NAMES) v[name] = 0.5;
    return v;
  }
}

// The beat-level signals carried on the /decide request (mirrors decision.yaml request signals).
export type BeatSignals = {
  completion?: number; // 0..1
  dwell_ms?: number;
  replays?: number;
  skipped?: boolean;
  choice?: string; // free-form branch choice label
};

// Normalize each raw signal to a comparable [0,1] scale BEFORE it enters the vector, so no single
// large-magnitude signal silently dominates (design 3).
function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
const DWELL_NORM_MS = 60_000; // a one minute dwell maps to 1.0; longer saturates
const REPLAY_NORM = 3; // three replays on a beat saturates to 1.0

// Fold new beat signals into the vector with an exponential moving average. Pure: returns a new vector.
export function updateVector(prev: PreferenceVector, signals: BeatSignals): PreferenceVector {
  const a = EMA_ALPHA;
  const ema = (old: number, observed: number) => a * clamp01(observed) + (1 - a) * old;
  const next: PreferenceVector = { ...prev };
  if (signals.completion !== undefined) next.completion_rate = ema(prev.completion_rate, signals.completion);
  if (signals.dwell_ms !== undefined) next.avg_dwell = ema(prev.avg_dwell, signals.dwell_ms / DWELL_NORM_MS);
  if (signals.replays !== undefined) next.replay_rate = ema(prev.replay_rate, signals.replays / REPLAY_NORM);
  if (signals.skipped !== undefined) next.skip_rate = ema(prev.skip_rate, signals.skipped ? 1 : 0);
  return next;
}
