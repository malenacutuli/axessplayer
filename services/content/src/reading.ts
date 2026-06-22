// PROMPT 28: the reading platform engine = the DEMAND SENSOR + the GRADUATION to video. Reading is the
// cheapest top of funnel and the demand sensor that de-risks video: a work's reading behavior flows into the
// SAME engagement_events pipeline as video, produces a demand_score, and a ready_to_adapt work graduates into
// a mobile.series via the existing beat graph, carrying its consent and provenance forward. Pure functions +
// SQL builders (the content-service style), so the scoring and the flywheel close are testable without a DB.
// Stays on Supabase Postgres, no new infra. No em dashes.

// ---------- reading event taxonomy (the demand sensor input, on the shared engagement stream) ----------
// Reading behavior emits these on the SAME AxpEvent pipeline as video; the work_id + chapter_index ride in the
// event payload (no new column), so the demand sensor is a group-by over engagement_events, not a new system.
export const READING_EVENT_TYPES = [
  "chapter_started",
  "chapter_completed",
  "work_finished",
  "chapter_reread",
  "work_shared",
  "work_followed", // the "this could become a series" follow
] as const;
export type ReadingEventType = (typeof READING_EVENT_TYPES)[number];

// ---------- the demand sensor ----------

// The signals the sensor derives per work from its reading events. All rates are 0..1 (or 0..1+ where a reader
// can repeat). finishVelocity is a 0..1 normalized speed (faster readers finishing = stronger demand).
export interface DemandSignals {
  nReaders: number;
  completion: number; // finish rate: work_finished / distinct readers who started
  rereadRate: number; // chapter_reread / chapter_started
  shareRate: number; // work_shared / distinct readers
  finishVelocity: number; // 0..1 normalized finish speed
  byCohort?: Record<string, number>; // cohort/market -> completion index, for "how it indexes by audience"
}

export interface DemandVerdict {
  demandScore: number; // 0..1
  status: "testing" | "ready_to_adapt";
  reasons: string[];
}

// FLAGGED placeholders: tune on real reading data before they gate real adaptation spend.
export const DEMAND_WEIGHTS = { completion: 0.4, rereadRate: 0.2, shareRate: 0.2, finishVelocity: 0.2 };
export const READY_THRESHOLD = 0.6;
export const MIN_READERS = 50;

function clamp01(x: number): number {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

// Compute the demand_score (weighted, in 0..1) and the readiness status. A work is ready_to_adapt only when
// the score clears the threshold AND it has enough readers to trust the signal (never adapt on a handful of
// reads). The number is the evidence the Studio shows next to the one-click "adapt to series".
export function computeDemandScore(s: DemandSignals): DemandVerdict {
  const completion = clamp01(s.completion);
  const reread = clamp01(s.rereadRate);
  const share = clamp01(s.shareRate);
  const velocity = clamp01(s.finishVelocity);
  const demandScore =
    +(DEMAND_WEIGHTS.completion * completion +
      DEMAND_WEIGHTS.rereadRate * reread +
      DEMAND_WEIGHTS.shareRate * share +
      DEMAND_WEIGHTS.finishVelocity * velocity).toFixed(4);
  const reasons: string[] = [];
  if (s.nReaders < MIN_READERS) reasons.push(`only ${s.nReaders} readers (need ${MIN_READERS})`);
  if (demandScore < READY_THRESHOLD) reasons.push(`demand ${demandScore} below ${READY_THRESHOLD}`);
  const status: DemandVerdict["status"] = reasons.length === 0 ? "ready_to_adapt" : "testing";
  return { demandScore, status, reasons };
}

// SQL that aggregates a work's reading engagement_events into the raw signal counts. Keyed on
// payload->>'work_id' (reading events carry the work id in the payload, reusing engagement_events with no new
// column). Cohort is read from payload->>'cohort' when present. SELECT-only.
export function buildDemandSignalsQuery(): { text: string; params: (v: string) => unknown[] } {
  const text = `
    with ev as (
      select user_id, type, coalesce(payload->>'cohort', payload->'props'->>'cohort') as cohort,
             coalesce(completion, (payload->'props'->>'completion')::float) as completion
      from mobile.engagement_events
      -- work_id rides top-level (server seeds) OR under props (the reader/AXP emit shape); accept both.
      where coalesce(payload->>'work_id', payload->'props'->>'work_id') = $1
        and type in ('chapter_started','chapter_completed','work_finished','chapter_reread','work_shared')
    )
    select
      count(distinct user_id) filter (where type = 'chapter_started') as readers,
      count(*) filter (where type = 'work_finished') as finishes,
      count(*) filter (where type = 'chapter_started') as starts,
      count(*) filter (where type = 'chapter_reread') as rereads,
      count(distinct user_id) filter (where type = 'work_shared') as sharers,
      avg(completion) filter (where type = 'chapter_completed' and completion is not null) as avg_completion
    from ev`;
  return { text, params: (workId: string) => [workId] };
}

// Map the aggregate row + a velocity input into DemandSignals. Defensive against zero denominators (a fresh
// work has no readers, not a divide-by-zero). finishVelocity is supplied by the caller (derived from the
// time-to-finish distribution) and defaults to the avg completion when not given.
export function mapDemandSignals(row: Record<string, unknown>, opts: { finishVelocity?: number } = {}): DemandSignals {
  const num = (k: string): number => {
    const v = row[k];
    return typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0;
  };
  const readers = num("readers");
  const starts = num("starts");
  const completion = readers > 0 ? num("finishes") / readers : 0;
  return {
    nReaders: readers,
    completion: clamp01(completion),
    rereadRate: starts > 0 ? num("rereads") / starts : 0,
    shareRate: readers > 0 ? num("sharers") / readers : 0,
    finishVelocity: clamp01(opts.finishVelocity ?? num("avg_completion")),
  };
}

// Persist the verdict to adaptation_candidates (upsert). status only auto-advances testing <-> ready_to_adapt;
// adapting/adapted are set by the graduation flow, never overwritten by a re-score.
export function buildUpsertCandidate(): { text: string; params: (workId: string, v: DemandVerdict, signals: DemandSignals) => unknown[] } {
  const text = `
    insert into mobile.adaptation_candidates (work_id, demand_score, signals, status, updated_at)
    values ($1, $2, $3::jsonb, $4, now())
    on conflict (work_id) do update set
      demand_score = excluded.demand_score,
      signals = excluded.signals,
      status = case when mobile.adaptation_candidates.status in ('adapting','adapted')
                    then mobile.adaptation_candidates.status else excluded.status end,
      updated_at = now()`;
  return { text, params: (workId, v, signals) => [workId, v.demandScore, JSON.stringify({ ...signals, demand_score: v.demandScore }), v.status] };
}

// ---------- graduation to video (close the flywheel) ----------

export interface WorkRow {
  id: string;
  title: string;
  genre: string | null;
  base_language: string;
  available_languages: string[];
  cover_url: string | null;
  consent_ref: string | null;
  provenance_id: string | null;
}
export interface ChapterRow {
  index: number;
  title: string | null;
}

// The seed for the new mobile.series + its beats, derived from a work's chapters. One beat per chapter, in
// order; the first beat is the setup, the last the ending, the rest rising. consent_ref + provenance_id carry
// forward so the adapted video is as cleanly licensed as the source text (the point of one substrate).
export interface SeriesSeed {
  title: string;
  genre: string | null;
  base_language: string;
  available_languages: string[];
  cover_url: string | null;
  format: string;
}
export interface EpisodeSeed {
  episode_number: number;
  title: string;
  is_free: boolean;
  coin_cost: number;
}
export interface BeatSeed {
  beat_index: number;
  role: string;
  canon_facts: Record<string, unknown>;
}
export interface GraduationPlan {
  series: SeriesSeed;
  // beats require an episode (beats.episode_id is NOT NULL): graduation seeds series -> episode 1 -> beats.
  episode: EpisodeSeed;
  beats: BeatSeed[];
  consentRef: string | null;
  provenanceId: string | null;
}

// Build the graduation plan (pure). Throws on a work with no chapters: there is nothing to seed a beat graph
// from, so graduation is refused rather than creating an empty series.
export function graduationPlan(work: WorkRow, chapters: readonly ChapterRow[]): GraduationPlan {
  if (chapters.length === 0) throw new Error("cannot graduate a work with no chapters");
  const ordered = [...chapters].sort((a, b) => a.index - b.index);
  const n = ordered.length;
  const roleFor = (i: number): string => (i === 0 ? "setup" : i === n - 1 ? "ending" : "rising");
  return {
    series: {
      title: work.title,
      genre: work.genre,
      base_language: work.base_language,
      available_languages: work.available_languages,
      cover_url: work.cover_url,
      format: "Series",
    },
    episode: { episode_number: 1, title: work.title, is_free: true, coin_cost: 0 },
    beats: ordered.map((c, i) => ({
      beat_index: i,
      role: roleFor(i),
      // the chapter is the canon source for the beat: its title + the source work + chapter index, so the
      // video beat is traceable to the text it adapts (and the Writer/Cinematographer can read it).
      canon_facts: { source_work_id: work.id, source_chapter_index: c.index, source_title: c.title ?? `Chapter ${c.index}` },
    })),
    consentRef: work.consent_ref,
    provenanceId: work.provenance_id,
  };
}
