// PROMPT 26 persistence: the three additive mobile tables behind one EngineDb port. The HTTP service depends
// only on this port; a Postgres adapter (PgEngineDb) backs the live service and an in-memory adapter
// (InMemoryEngineDb) backs tests and the unwired-preview boot. The tables are mobile-schema only, so the
// queries qualify them with mobile. explicitly (the live pool also runs search_path=mobile,public).
//
// reference_embeddings = the enrolled references the consistency scorer compares a shot against.
// generation_attempts = the cost-metered, retry-tracked attempt log (the second flywheel).
// qa_scores = the labeled per-shot consistency scores (the QA pass-rate + the IP dataset).
// No em dashes.

import type pg from "pg";
import type { ShotScore } from "./consistency.js";

type Q = Pick<pg.Pool, "query">;

export interface ReferenceEmbeddingInsert {
  series_id: string;
  owner_type: "character" | "scene";
  owner_ref: string;
  kind: "face" | "scene";
  embedding: number[] | null; // NULL on the non-sovereign plane for kind 'face'
  model: string;
  dim: number | null;
}
export interface ReferenceEmbeddingRow extends ReferenceEmbeddingInsert {
  id: string;
  created_at: string;
}

export interface AttemptInsert {
  spec_id: string;
  beat_id: string | null;
  attempt: number;
  provider: string;
  model_handle: string;
  model_id: string;
  output_url: string | null;
  passed: boolean;
  reason: string | null;
  cost_usd: number;
  cached: boolean;
  state: "queued" | "running" | "done" | "failed" | "paused_over_budget";
}
export interface AttemptRow extends AttemptInsert {
  id: string;
  created_at: string;
}

export interface QaScoreInsert {
  generation_attempt_id: string | null;
  beat_variant_id: string | null;
  face_cosine: number | null;
  scene_score: number | null;
  thresholds: Record<string, unknown>;
  passed: boolean;
  reasons: string[];
}
export interface QaScoreRow extends QaScoreInsert {
  id: string;
  created_at: string;
}

export interface EngineDb {
  insertReferenceEmbedding(row: ReferenceEmbeddingInsert): Promise<ReferenceEmbeddingRow>;
  getReferenceEmbeddings(seriesId: string, ownerType: "character" | "scene", ownerRef: string): Promise<ReferenceEmbeddingRow[]>;
  insertAttempt(row: AttemptInsert): Promise<AttemptRow>;
  insertQaScore(row: QaScoreInsert): Promise<QaScoreRow>;
  listAttempts(specId: string): Promise<AttemptRow[]>;
}

// Convenience: derive the score columns from a ShotScore.
export function scoreColumns(score: ShotScore | null): { face_cosine: number | null; scene_score: number | null } {
  return { face_cosine: score?.faceCosine ?? null, scene_score: score?.sceneScore ?? null };
}

export class PgEngineDb implements EngineDb {
  constructor(private readonly db: Q) {}

  async insertReferenceEmbedding(row: ReferenceEmbeddingInsert): Promise<ReferenceEmbeddingRow> {
    const r = await this.db.query(
      `insert into mobile.reference_embeddings (series_id, owner_type, owner_ref, kind, embedding, model, dim)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, series_id, owner_type, owner_ref, kind, embedding, model, dim, created_at`,
      [row.series_id, row.owner_type, row.owner_ref, row.kind, row.embedding == null ? null : JSON.stringify(row.embedding), row.model, row.dim],
    );
    return mapReference(r.rows[0]);
  }

  async getReferenceEmbeddings(seriesId: string, ownerType: "character" | "scene", ownerRef: string): Promise<ReferenceEmbeddingRow[]> {
    const r = await this.db.query(
      `select id, series_id, owner_type, owner_ref, kind, embedding, model, dim, created_at
       from mobile.reference_embeddings
       where series_id = $1 and owner_type = $2 and owner_ref = $3
       order by created_at asc`,
      [seriesId, ownerType, ownerRef],
    );
    return r.rows.map(mapReference);
  }

  async insertAttempt(row: AttemptInsert): Promise<AttemptRow> {
    const r = await this.db.query(
      `insert into mobile.generation_attempts
         (spec_id, beat_id, attempt, provider, model_handle, model_id, output_url, passed, reason, cost_usd, cached, state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id, spec_id, beat_id, attempt, provider, model_handle, model_id, output_url, passed, reason, cost_usd, cached, state, created_at`,
      [row.spec_id, row.beat_id, row.attempt, row.provider, row.model_handle, row.model_id, row.output_url, row.passed, row.reason, row.cost_usd, row.cached, row.state],
    );
    return mapAttempt(r.rows[0]);
  }

  async insertQaScore(row: QaScoreInsert): Promise<QaScoreRow> {
    const r = await this.db.query(
      `insert into mobile.qa_scores
         (generation_attempt_id, beat_variant_id, face_cosine, scene_score, thresholds, passed, reasons)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, generation_attempt_id, beat_variant_id, face_cosine, scene_score, thresholds, passed, reasons, created_at`,
      [row.generation_attempt_id, row.beat_variant_id, row.face_cosine, row.scene_score, JSON.stringify(row.thresholds), row.passed, row.reasons],
    );
    return mapQaScore(r.rows[0]);
  }

  async listAttempts(specId: string): Promise<AttemptRow[]> {
    const r = await this.db.query(
      `select id, spec_id, beat_id, attempt, provider, model_handle, model_id, output_url, passed, reason, cost_usd, cached, state, created_at
       from mobile.generation_attempts where spec_id = $1 order by attempt asc, created_at asc`,
      [specId],
    );
    return r.rows.map(mapAttempt);
  }
}

// In-memory adapter: backs tests and the unwired-preview boot. Same observable behavior, no DB.
export class InMemoryEngineDb implements EngineDb {
  private refs: ReferenceEmbeddingRow[] = [];
  private attempts: AttemptRow[] = [];
  private scores: QaScoreRow[] = [];
  private seq = 0;
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq.toString(16).padStart(8, "0")}`;
  }
  private now(): string {
    // Deterministic monotonic stamp (Date.now is unavailable in some sandboxes; tests do not assert it).
    this.seq += 1;
    return `1970-01-01T00:00:${String(this.seq % 60).padStart(2, "0")}.000Z`;
  }

  async insertReferenceEmbedding(row: ReferenceEmbeddingInsert): Promise<ReferenceEmbeddingRow> {
    const out: ReferenceEmbeddingRow = { ...row, id: this.id("ref"), created_at: this.now() };
    this.refs.push(out);
    return out;
  }
  async getReferenceEmbeddings(seriesId: string, ownerType: "character" | "scene", ownerRef: string): Promise<ReferenceEmbeddingRow[]> {
    return this.refs.filter((r) => r.series_id === seriesId && r.owner_type === ownerType && r.owner_ref === ownerRef);
  }
  async insertAttempt(row: AttemptInsert): Promise<AttemptRow> {
    const out: AttemptRow = { ...row, id: this.id("att"), created_at: this.now() };
    this.attempts.push(out);
    return out;
  }
  async insertQaScore(row: QaScoreInsert): Promise<QaScoreRow> {
    const out: QaScoreRow = { ...row, id: this.id("qa"), created_at: this.now() };
    this.scores.push(out);
    return out;
  }
  async listAttempts(specId: string): Promise<AttemptRow[]> {
    return this.attempts.filter((a) => a.spec_id === specId).sort((a, b) => a.attempt - b.attempt);
  }
}

function toNumArray(v: unknown): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => Number(x));
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => Number(x)) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapReference(r: Record<string, unknown>): ReferenceEmbeddingRow {
  return {
    id: r.id as string,
    series_id: r.series_id as string,
    owner_type: r.owner_type as "character" | "scene",
    owner_ref: r.owner_ref as string,
    kind: r.kind as "face" | "scene",
    embedding: toNumArray(r.embedding),
    model: r.model as string,
    dim: r.dim == null ? null : Number(r.dim),
    created_at: String(r.created_at),
  };
}

function mapAttempt(r: Record<string, unknown>): AttemptRow {
  return {
    id: r.id as string,
    spec_id: r.spec_id as string,
    beat_id: (r.beat_id as string) ?? null,
    attempt: Number(r.attempt),
    provider: r.provider as string,
    model_handle: r.model_handle as string,
    model_id: r.model_id as string,
    output_url: (r.output_url as string) ?? null,
    passed: Boolean(r.passed),
    reason: (r.reason as string) ?? null,
    cost_usd: Number(r.cost_usd),
    cached: Boolean(r.cached),
    state: r.state as AttemptRow["state"],
    created_at: String(r.created_at),
  };
}

function mapQaScore(r: Record<string, unknown>): QaScoreRow {
  return {
    id: r.id as string,
    generation_attempt_id: (r.generation_attempt_id as string) ?? null,
    beat_variant_id: (r.beat_variant_id as string) ?? null,
    face_cosine: r.face_cosine == null ? null : Number(r.face_cosine),
    scene_score: r.scene_score == null ? null : Number(r.scene_score),
    thresholds: (typeof r.thresholds === "string" ? JSON.parse(r.thresholds) : r.thresholds) as Record<string, unknown>,
    passed: Boolean(r.passed),
    reasons: (r.reasons as string[]) ?? [],
    created_at: String(r.created_at),
  };
}
