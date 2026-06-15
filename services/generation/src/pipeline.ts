// The offline variant pipeline. A queue-driven batch job: input a beat plus a generation spec, output one
// or more beat_variants rows with their media and metadata, each attested by a C2PA manifest and each
// gated by QA before it can serve. The expensive media work goes through the cost gate (mocked in tests
// and the dry run). The pipeline:
//   1. resolves and validates the beat,
//   2. plans the requested variants into concrete, defaulted, validated row inserts,
//   3. produces media for each via the injected (mocked) backend, behind the cost gate,
//   4. inserts each row at qa_status = pending (never servable straight out of the pipeline),
//   5. emits a C2PA manifest per row for W9,
//   6. runs the QA gate and promotes pending -> passed | rejected; rejected never serves.
// No SQL lives here; the GenerationDB port persists. No em dashes.

import {
  type GenerationSpec,
  type VariantRequest,
  type VariantRowInsert,
  type VariantRow,
  type BeatRef,
  VARIANT_KINDS,
  VARIANT_TIERS,
  INTENSITY_DEFAULT,
  INTENSITY_MIN,
  INTENSITY_MAX,
  isUuid,
  isObject,
} from "./spec.js";
import {
  type MediaBackend,
  type MediaJob,
  assertCostGate,
  type CostGateOptions,
} from "./backends.js";
import { buildManifest, type C2paManifest } from "./c2pa.js";
import { runQaCheck, type QaResult } from "./qa.js";
import type { GenerationDB } from "./generationDb.js";

// One fully resolved output of the pipeline for a single requested variant.
export interface ProducedVariant {
  row: VariantRow; // the inserted row, with its final qa_status after the gate
  manifest: C2paManifest; // the unsigned C2PA manifest for W9 to sign and record
  qa: QaResult; // the gate decision and its reasons
}

export interface PipelineRunResult {
  spec_id: string;
  beat_id: string;
  produced: ProducedVariant[];
  // Convenience tallies for the dry run / job log.
  passed: number;
  rejected: number;
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

// ---------- planning: a VariantRequest -> a defaulted, validated VariantRowInsert ----------
// Server-authoritative: defaults are applied here, a client price is never trusted past the documented
// bounds, and qa_status is forced to pending. Throws PipelineError on an invalid request so a bad spec
// fails before any (paid) media call.
export function planVariant(beat: BeatRef, req: VariantRequest): VariantRowInsert {
  if (!isObject(req)) throw new PipelineError("invalid_variant_request");
  if (!VARIANT_KINDS.includes(req.kind)) throw new PipelineError("invalid_kind");
  if (!VARIANT_TIERS.includes(req.tier)) throw new PipelineError("invalid_tier");

  const language = req.language ?? "en";
  if (typeof language !== "string" || language.length === 0) throw new PipelineError("invalid_language");

  const intensity = req.intensity ?? INTENSITY_DEFAULT;
  if (!Number.isInteger(intensity) || intensity < INTENSITY_MIN || intensity > INTENSITY_MAX) {
    throw new PipelineError("invalid_intensity");
  }

  const pov = req.pov ?? null;
  if (pov != null && typeof pov !== "string") throw new PipelineError("invalid_pov");

  const is_premium = req.is_premium ?? false;
  if (typeof is_premium !== "boolean") throw new PipelineError("invalid_is_premium");

  const coin_cost = req.coin_cost ?? 0;
  if (!Number.isInteger(coin_cost) || coin_cost < 0) throw new PipelineError("invalid_coin_cost");

  const baseAccess = isObject(req.accessibility) ? { ...req.accessibility } : {};
  const accessibility = applyKindAccessibility(req, baseAccess);

  return {
    beat_id: beat.id,
    language,
    accessibility,
    intensity,
    pov,
    tier: req.tier,
    is_premium,
    coin_cost,
    playback_url: "", // filled after the media backend produces the artifact
    duration_ms: null, // filled from the artifact
    qa_status: "pending", // forced: the pipeline never produces a servable row directly
    placement_slots: [],
  };
}

// The variant kind sets the accessibility flags it is responsible for. captions, audio_description, and
// sign are accessibility kinds; dubbing / intensity / pov leave the flags as the caller passed them.
function applyKindAccessibility(
  req: VariantRequest,
  access: Record<string, unknown>
): Record<string, unknown> {
  switch (req.kind) {
    case "captions":
      return { ...access, captions: true };
    case "audio_description":
      return { ...access, audio_description: true };
    case "sign": {
      // sign expects a sign locale in accessibility.sign; default to ase if unspecified.
      const sign = typeof access.sign === "string" && access.sign.length > 0 ? access.sign : "ase";
      return { ...access, sign };
    }
    default:
      return access;
  }
}

// ---------- the run ----------
export interface RunOptions extends CostGateOptions {
  // Pin time for deterministic manifests in tests.
  now?: () => Date;
}

export async function runPipeline(
  spec: GenerationSpec,
  deps: { db: GenerationDB; media: MediaBackend },
  opts: RunOptions = {}
): Promise<PipelineRunResult> {
  if (!isObject(spec)) throw new PipelineError("invalid_spec");
  if (typeof spec.spec_id !== "string" || spec.spec_id.length === 0) {
    throw new PipelineError("invalid_spec_id");
  }
  if (!isObject(spec.beat) || !isUuid(spec.beat.id)) throw new PipelineError("invalid_beat");
  if (!Array.isArray(spec.variants) || spec.variants.length === 0) {
    throw new PipelineError("empty_variants");
  }

  // The cost gate is checked once, up front, before any media call. A real-cost backend aborts here unless
  // a human has opened the gate.
  assertCostGate(deps.media, opts);

  // Resolve the beat from the DB (read-only) and reconcile it with the spec's BeatRef.
  const beatRecord = await deps.db.getBeat(spec.beat.id);
  if (!beatRecord) throw new PipelineError("unknown_beat_id");
  if (beatRecord.series_id !== spec.beat.series_id) throw new PipelineError("series_mismatch");
  if (beatRecord.episode_id !== spec.beat.episode_id) throw new PipelineError("episode_mismatch");

  const produced: ProducedVariant[] = [];

  for (const req of spec.variants) {
    // 1. plan (validates and defaults; throws before any media call on a bad request).
    const plan = planVariant(spec.beat, req);

    // 2. produce media via the (mocked) backend.
    const job: MediaJob = {
      kind: req.kind,
      tier: plan.tier,
      source_url: spec.beat.source_url,
      language: plan.language,
      intensity: plan.intensity,
      pov: plan.pov,
      accessibility: plan.accessibility,
      duration_ms: spec.beat.duration_ms,
    };
    const artifact = await deps.media.produce(job);

    // 3. finalize the row insert with the produced media, then insert at qa_status = pending.
    const rowInsert: VariantRowInsert = {
      ...plan,
      playback_url: artifact.playback_url,
      duration_ms: artifact.duration_ms,
      qa_status: "pending",
    };
    const row = await deps.db.insertVariant(rowInsert);

    // 4. emit the C2PA manifest for this row (W9 signs and records it).
    const manifest = buildManifest({
      beatVariantId: row.id,
      tier: row.tier,
      kind: req.kind,
      artifact,
      source_url: spec.beat.source_url,
      now: opts.now,
    });

    // 5. run the QA gate and promote pending -> passed | rejected.
    const qa = runQaCheck({ row, manifest });
    const promoted = await deps.db.setQaStatus(row.id, qa.status);
    // promoted is null only if the row was not pending; here it always is, so use it when present.
    const finalRow = promoted ?? { ...row, qa_status: qa.status };

    produced.push({ row: finalRow, manifest, qa });
  }

  const passed = produced.filter((p) => p.qa.status === "passed").length;
  const rejected = produced.filter((p) => p.qa.status === "rejected").length;

  return { spec_id: spec.spec_id, beat_id: spec.beat.id, produced, passed, rejected };
}

// ---------- a queue worker over many specs ----------
// The batch job: drain a queue of specs, run each, collect results. A failure on one spec does not abort
// the batch; it is captured so the queue can retry or dead-letter it.
export interface QueueItemResult {
  spec_id: string;
  ok: boolean;
  result?: PipelineRunResult;
  error?: string;
}

export async function runBatch(
  specs: GenerationSpec[],
  deps: { db: GenerationDB; media: MediaBackend },
  opts: RunOptions = {}
): Promise<QueueItemResult[]> {
  const out: QueueItemResult[] = [];
  for (const spec of specs) {
    try {
      const result = await runPipeline(spec, deps, opts);
      out.push({ spec_id: spec?.spec_id ?? "unknown", ok: true, result });
    } catch (e) {
      out.push({
        spec_id: spec?.spec_id ?? "unknown",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}
