// PROMPT 28 reading orchestration: the executable layer over reading.ts. Two operations the Studio calls:
// recomputeDemand (run the demand sensor for a work and persist the verdict) and adaptWork (graduate a
// ready_to_adapt work into a video series + episode + beats). Both take an injected ReadingDb port so they
// are unit-testable without a database; the production adapter runs the SQL builders from reading.ts. Stays
// on Supabase Postgres. No em dashes.

import {
  computeDemandScore,
  graduationPlan,
  type ChapterRow,
  type DemandSignals,
  type DemandVerdict,
  type GraduationPlan,
  type WorkRow,
} from "./reading.js";

// ---------- product input shapes (the reader/Studio surface) ----------
export interface CreateWorkInput {
  title: string;
  synopsis?: string;
  genre?: string;
  language?: string;
  base_language?: string;
  available_languages?: string[];
  cover_url?: string;
  author_id?: string;
  origin?: "creator_self_publish" | "editorial" | "in_house";
  consent_ref?: string;
  provenance_id?: string;
  ai_assisted?: boolean;
}
export interface CreateChapterInput {
  index: number;
  title?: string;
  body_ref?: string;
  is_free?: boolean;
  coin_cost?: number;
  accessibility?: Record<string, unknown>;
}
export interface WorkDetail {
  work: Record<string, unknown>;
  chapters: Record<string, unknown>[];
}
export interface CandidateRow {
  work_id: string;
  title: string;
  demand_score: number;
  status: string;
  signals: Record<string, unknown>;
  linked_series_id: string | null;
}
export interface WorkCard {
  id: string;
  title: string;
  synopsis: string | null;
  genre: string | null;
  cover_url: string | null;
  chapters: number;
  free_chapters: number;
}

// The data access the orchestration needs. The real impl runs reading.ts SQL builders + the series/episode/
// beat inserts (the same ContentDB the video path uses); fakes drive tests.
export interface ReadingDb {
  getWork(workId: string): Promise<WorkRow | null>;
  listChapters(workId: string): Promise<ChapterRow[]>;
  // run the demand aggregate (buildDemandSignalsQuery + mapDemandSignals) for one work.
  demandSignals(workId: string): Promise<DemandSignals>;
  upsertCandidate(workId: string, verdict: DemandVerdict, signals: DemandSignals): Promise<void>;
  candidateStatus(workId: string): Promise<string | null>;
  // seed a new series + episode 1 + one beat per chapter from the graduation plan; returns the new series id.
  seedSeriesFromPlan(plan: GraduationPlan): Promise<{ seriesId: string }>;
  // mark the candidate adapting and link the seeded series.
  linkGraduated(workId: string, seriesId: string): Promise<void>;
}

// The full reading store the HTTP surface needs: the demand/graduation ports above plus the product CRUD.
export interface ReadingStore extends ReadingDb {
  createWork(input: CreateWorkInput): Promise<{ id: string }>;
  addChapter(workId: string, input: CreateChapterInput): Promise<{ id: string }>;
  publishWork(workId: string): Promise<void>;
  getWorkDetail(workId: string): Promise<WorkDetail | null>;
  upsertReadingState(userId: string, workId: string, chapterIndex: number, percent: number): Promise<void>;
  listCandidates(status?: string): Promise<CandidateRow[]>;
  listPublishedWorks(): Promise<WorkCard[]>;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Validate + create a work. Title is required; origin/consent default sensibly. Returns the new work id.
export async function createWork(input: CreateWorkInput, store: ReadingStore): Promise<{ id: string }> {
  if (!nonEmptyString(input.title)) throw new ReadingError("invalid_title", "title is required");
  return store.createWork(input);
}

// Validate + add a chapter (installment) to a work. index must be a positive integer; coin_cost non-negative.
export async function addChapter(workId: string, input: CreateChapterInput, store: ReadingStore): Promise<{ id: string }> {
  const work = await store.getWork(workId);
  if (!work) throw new ReadingError("work_not_found", `no work ${workId}`);
  if (!Number.isInteger(input.index) || input.index < 1) throw new ReadingError("invalid_index", "chapter index must be a positive integer");
  if (input.coin_cost != null && (!Number.isInteger(input.coin_cost) || input.coin_cost < 0)) throw new ReadingError("invalid_coin_cost", "coin_cost must be a non-negative integer");
  return store.addChapter(workId, input);
}

// Upsert a reader's progress (the reading_state sibling of viewer_state). percent clamps to [0,1].
export async function upsertReadingState(userId: string, workId: string, chapterIndex: number, percent: number, store: ReadingStore): Promise<void> {
  const p = !Number.isFinite(percent) ? 0 : percent < 0 ? 0 : percent > 1 ? 1 : percent;
  const idx = Number.isInteger(chapterIndex) && chapterIndex >= 1 ? chapterIndex : 1;
  await store.upsertReadingState(userId, workId, idx, p);
}

export class ReadingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReadingError";
    this.code = code;
  }
}

// Run the demand sensor for one work: aggregate its reading events into signals, score them, and persist the
// verdict to adaptation_candidates. Returns the verdict so the Studio dashboard can show the evidence.
export async function recomputeDemand(workId: string, db: ReadingDb): Promise<{ verdict: DemandVerdict; signals: DemandSignals }> {
  const signals = await db.demandSignals(workId);
  const verdict = computeDemandScore(signals);
  await db.upsertCandidate(workId, verdict, signals);
  return { verdict, signals };
}

export interface AdaptResult {
  seriesId: string;
  beats: number;
  consentRef: string | null;
  provenanceId: string | null;
}

// Graduate a work into a video series (the one-click "adapt to series"). Guards: the work must exist, have
// chapters, and (unless forced) be ready_to_adapt. Seeds series -> episode 1 -> one beat per chapter, carrying
// consent + provenance forward, then links the candidate as adapting. Idempotency is the caller's concern
// (re-adapting a work that is already adapting/adapted should be blocked upstream); here we refuse to adapt a
// work that is not ready unless force is set (the founder override path).
export async function adaptWork(workId: string, db: ReadingDb, opts: { force?: boolean } = {}): Promise<AdaptResult> {
  const work = await db.getWork(workId);
  if (!work) throw new ReadingError("work_not_found", `no work ${workId}`);
  if (!opts.force) {
    const status = await db.candidateStatus(workId);
    if (status !== "ready_to_adapt") {
      throw new ReadingError("not_ready", `work ${workId} is ${status ?? "untested"}, not ready_to_adapt (use force to override)`);
    }
  }
  const chapters = await db.listChapters(workId);
  // graduationPlan throws on zero chapters; surface it as a typed error.
  let plan: GraduationPlan;
  try {
    plan = graduationPlan(work, chapters);
  } catch (e) {
    throw new ReadingError("no_chapters", e instanceof Error ? e.message : String(e));
  }
  const { seriesId } = await db.seedSeriesFromPlan(plan);
  await db.linkGraduated(workId, seriesId);
  return { seriesId, beats: plan.beats.length, consentRef: plan.consentRef, provenanceId: plan.provenanceId };
}
