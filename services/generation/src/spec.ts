// Generation spec and variant-row shapes for the W8 offline pipeline. This file is the single source of
// truth for the enums and row shapes the pipeline produces, bound to the frozen schema column comments in
// supabase/migrations/0001_init.sql (beat_variants). The schema is read, never altered. A drift between
// these constants and the schema comments would surface as a Postgres reject in the row-shape acceptance
// test, which runs against a real server. No em dashes.

// ---------- enums (frozen schema column comments) ----------
// beats.role: spine|hero|variant|connective|ending|cold_open
export const BEAT_ROLES = ["spine", "hero", "variant", "connective", "ending", "cold_open"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

// beat_variants.tier: A_filmed|B_likeness|C_ai
export const VARIANT_TIERS = ["A_filmed", "B_likeness", "C_ai"] as const;
export type VariantTier = (typeof VARIANT_TIERS)[number];

// beat_variants.qa_status: pending|passed|rejected
export const QA_STATUSES = ["pending", "passed", "rejected"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

// beat_variants.intensity is a SMALLINT in 1..5 with a default of 3.
export const INTENSITY_MIN = 1;
export const INTENSITY_MAX = 5;
export const INTENSITY_DEFAULT = 3;

// ---------- variant kinds the pipeline knows how to produce ----------
// Each kind maps a (beat + generation spec) to one or more beat_variants rows. The kind drives which media
// backend runs and which accessibility / language / intensity / pov columns it sets. The kind itself is
// not a schema column: it is the pipeline's planning vocabulary. The produced row only ever uses the
// frozen columns.
export const VARIANT_KINDS = [
  "dubbing", // a language dub track: sets language, tier carries over from the source plan
  "captions", // timed-text captions for a language: accessibility.captions = true
  "audio_description", // an audio-description track: accessibility.audio_description = true
  "sign", // a sign-language track: accessibility.sign = <sign locale>
  "intensity", // an intensity recut: sets intensity 1..5
  "pov", // a point-of-view recut: sets pov
] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

// ---------- the input to a pipeline run ----------
// A beat to operate on (read-only; the pipeline never writes beats) plus a generation spec describing the
// fan-out of variants to produce for that beat.
export interface BeatRef {
  id: string;
  series_id: string;
  episode_id: string;
  role: BeatRole;
  // The source media the recuts derive from. A real run would point at the filmed spine segment; the
  // pipeline treats it opaquely and hands it to the (mocked) media backend.
  source_url: string;
  duration_ms: number;
}

// One requested variant inside a spec. Optional fields default server-side in planning, never from a
// client price. coin_cost is server-authoritative and must be a non-negative integer.
export interface VariantRequest {
  kind: VariantKind;
  tier: VariantTier;
  language?: string; // default en
  // Accessibility hints the kind needs. For sign, sign is the sign locale (for example ase). For
  // audio_description / captions the kind sets the flag itself; callers may add contrast / pace.
  accessibility?: Record<string, unknown>;
  intensity?: number; // 1..5, default 3; required-meaningful only for the intensity kind
  pov?: string | null; // required-meaningful only for the pov kind
  is_premium?: boolean; // default false
  coin_cost?: number; // default 0, must be >= 0
}

export interface GenerationSpec {
  // A stable id so a re-run of the same spec is idempotent at the queue level (the caller dedupes on it).
  spec_id: string;
  beat: BeatRef;
  variants: VariantRequest[];
}

// ---------- the row the pipeline produces (insert shape; id is assigned by Postgres) ----------
// Mirrors beat_variants exactly, minus the DB-assigned id and the provenance_id (which W9 backfills after
// it records the manifest). placement_slots defaults to an empty array. qa_status always lands pending:
// the pipeline never produces a servable row directly. promotion is the QA gate's job.
export interface VariantRowInsert {
  beat_id: string;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  qa_status: QaStatus; // always "pending" out of the pipeline
  placement_slots: unknown[];
}

// The row as it comes back from Postgres after insert, with its assigned id.
export interface VariantRow extends VariantRowInsert {
  id: string;
  provenance_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
