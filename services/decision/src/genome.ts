// K2/T2: the Viewer Genome feature builder. Derives the per-viewer genome from engagement_events and writes
// it to viewer_state.preference_vector (the hot serving read). Pure and deterministic so it is testable and
// reproducible; the live job (genomeUpsertSql) runs the same shape as a Postgres upsert. Stays on Supabase
// Postgres, no stream/warehouse. No em dashes.
//
// The genome is nine EWMA narrative-affinity features in [0,1] plus an archetype cluster for cold start, the
// consent flags, and a maturity counter (n_sessions, n_beats_seen). Features with no signal yet hold the
// neutral prior 0.5 at low maturity, which is honest: a fresh viewer has no evidence, not a fake preference.

export const GENOME_ATTRIBUTES = [
  "romance_affinity",
  "conflict_tolerance",
  "pacing_preference",
  "caption_reliance",
  "completion_propensity",
  "unlock_propensity",
  "ad_tolerance",
  "brand_receptivity",
  "churn_risk",
] as const;
export type GenomeAttribute = (typeof GENOME_ATTRIBUTES)[number];

export const NEUTRAL_PRIOR = 0.5;
export const EWMA_ALPHA = 0.3; // weight on the newest observation

// One engagement event, the columns the builder reads from mobile.engagement_events.
export interface GenomeEvent {
  userId: string;
  seriesId: string | null;
  sessionId: string | null;
  type: string;
  completion: number | null;
  payload: Record<string, unknown> | null;
  ts: number; // epoch ms, for ordering
}

export interface ViewerGenome {
  userId: string;
  seriesId: string | null;
  preferenceVector: Record<GenomeAttribute, number>;
  archetypeCluster: string;
  nSessions: number;
  nBeatsSeen: number;
  consent: { adaptive: boolean; data_capture: boolean };
}

// Map one event to the attribute signals it provides, each in [0,1]. An attribute absent from the map is not
// updated by this event (so a viewer with no romance signal keeps the neutral prior, not a fabricated value).
function signalsOf(e: GenomeEvent): Partial<Record<GenomeAttribute, number>> {
  const p = e.payload ?? {};
  const num = (k: string): number | undefined => (typeof p[k] === "number" ? (p[k] as number) : undefined);
  const bool = (k: string): number | undefined => (typeof p[k] === "boolean" ? ((p[k] as boolean) ? 1 : 0) : undefined);
  const out: Partial<Record<GenomeAttribute, number>> = {};

  // completion is the strongest available signal: it drives completion_propensity and lowers churn_risk.
  if (typeof e.completion === "number") {
    out.completion_propensity = clamp01(e.completion);
    out.churn_risk = clamp01(1 - e.completion);
  }
  // explicit narrative-tag signals when the client emits them (data-capture north star).
  for (const a of GENOME_ATTRIBUTES) {
    const v = num(a) ?? bool(a);
    if (v !== undefined) out[a] = clamp01(v);
  }
  // event-type derived signals.
  if (e.type === "unlock" || e.type === "premium_unlock") out.unlock_propensity = 1;
  if (e.type === "paywall_presented" && bool("unlocked") !== undefined) out.unlock_propensity = bool("unlocked")!;
  if (e.type === "ad_completed") out.ad_tolerance = 1;
  if (e.type === "ad_skipped") out.ad_tolerance = 0;
  const cap = bool("captions_on");
  if (cap !== undefined) out.caption_reliance = cap;
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Assign a coarse cold-start archetype from the matured vector. Deterministic buckets so two viewers with the
// same genome land in the same cluster (the cluster seeds cold-start serving before the vector matures).
export function archetypeOf(v: Record<GenomeAttribute, number>): string {
  if (v.completion_propensity >= 0.66) return v.pacing_preference >= 0.55 ? "binger_fast" : "binger_steady";
  if (v.unlock_propensity >= 0.6) return "spender";
  if (v.churn_risk >= 0.6) return "at_risk";
  if (v.caption_reliance >= 0.6) return "accessibility_first";
  return "explorer";
}

// Build the genome for one viewer from their events in time order. EWMA per attribute starting at the neutral
// prior; maturity counts distinct sessions and beat-bearing events. Consent flags come from the latest event
// that carries them (default false: capture is opt-in, fail closed).
export function buildViewerGenome(userId: string, events: GenomeEvent[]): ViewerGenome {
  const ordered = [...events].sort((a, b) => a.ts - b.ts);
  const vec = Object.fromEntries(GENOME_ATTRIBUTES.map((a) => [a, NEUTRAL_PRIOR])) as Record<GenomeAttribute, number>;
  const sessions = new Set<string>();
  let nBeatsSeen = 0;
  let seriesId: string | null = null;
  const consent = { adaptive: false, data_capture: false };

  for (const e of ordered) {
    seriesId = e.seriesId ?? seriesId;
    if (e.sessionId) sessions.add(e.sessionId);
    if (e.type === "impression" || e.type === "beat_complete" || e.type === "beat_started") nBeatsSeen++;
    const p = e.payload ?? {};
    if (typeof p.adaptive_opt_in === "boolean") consent.adaptive = p.adaptive_opt_in as boolean;
    if (typeof p.data_capture_consent === "boolean") consent.data_capture = p.data_capture_consent as boolean;
    const signals = signalsOf(e);
    for (const a of GENOME_ATTRIBUTES) {
      const s = signals[a];
      if (s !== undefined) vec[a] = round4((1 - EWMA_ALPHA) * vec[a] + EWMA_ALPHA * s);
    }
  }

  return {
    userId,
    seriesId,
    preferenceVector: vec,
    archetypeCluster: archetypeOf(vec),
    nSessions: sessions.size,
    nBeatsSeen,
    consent,
  };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

// Build the genome for every active viewer from a flat event list. One ViewerGenome per (user) that has at
// least one event. (Keyed per user; series is captured for the viewer_state PK at write time.)
export function buildGenomes(events: GenomeEvent[]): ViewerGenome[] {
  const byUser = new Map<string, GenomeEvent[]>();
  for (const e of events) {
    const arr = byUser.get(e.userId) ?? [];
    arr.push(e);
    byUser.set(e.userId, arr);
  }
  return [...byUser.entries()].map(([userId, evs]) => buildViewerGenome(userId, evs));
}

// The preference_vector jsonb payload written to viewer_state: the nine features plus the maturity counters
// and consent, so the serving read has everything it needs without a second query.
export function preferenceVectorPayload(g: ViewerGenome): Record<string, unknown> {
  return {
    ...g.preferenceVector,
    archetype_cluster: g.archetypeCluster,
    n_sessions: g.nSessions,
    n_beats_seen: g.nBeatsSeen,
    consent: g.consent,
    schema: "genome.v1",
  };
}
