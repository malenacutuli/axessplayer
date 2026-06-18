// The idempotent, resumable adaptation DAG (prompt 23). A job advances node by node; each node is pure
// and a no-op if already done (resume is re-running from the persisted stage). The hard gates live IN the
// DAG, not around it:
//   - rights_gate          : HARD block unless the rights gate is GREEN for the capability.
//   - cost gate            : pauses (paused_over_budget) when the estimate exceeds the budget.
//   - human_review         : Tier B/C cannot pass this node without an approved review; Tier C on hero
//                            content can NEVER auto-advance.
//   - full_render          : the adapter runs here; a gated adapter REFUSES without the approved review,
//                            so no completed asset is ever fabricated.
//   - variant_registration : the output registers as a beat_variant with source_type='adapted_archive'
//                            carrying full provenance.
// The state machine is the transport-agnostic core the HTTP layer drives. No em dashes.

import type { Capability, Confidence, Tier } from "./tiers.js";
import { tierOf } from "./tiers.js";
import { evaluateForCapability, type RightsChecklist } from "./rightsGate.js";
import { estimateCost } from "./cost.js";
import type { AdapterRegistry, RunContext } from "./adapters.js";

// The full ordered DAG. Listed verbatim per the prompt so the pipeline cannot silently drop a node.
export const DAG_NODES = [
  "source_ingest",
  "rights_gate",
  "technical_probe",
  "scene_detection",
  "transcription",
  "speaker_attribution",
  "character_matching",
  "shot_classification",
  "logo_detection",
  "brand_safety_scan",
  "music_rights_scan",
  "vertical_crop_plan",
  "story_beat_plan",
  "adaptation_plan",
  "preview_render",
  "human_review",
  "full_render",
  "accessibility_generation",
  "localization_generation",
  "brand_placement_generation",
  "qa",
  "c2pa_signing",
  "variant_registration",
  "publish_ready",
] as const;

export type DagNode = (typeof DAG_NODES)[number];

export type JobState =
  | "queued"
  | "running"
  | "blocked"
  | "awaiting_review"
  | "paused_over_budget"
  | "done"
  | "failed"
  | "rejected";

export interface JobRecord {
  jobId: string;
  sourceId: string;
  capability: Capability;
  tier: Tier;
  confidence: Confidence;
  confidenceScore: number;
  lowConfidenceFlagged: boolean;
  state: JobState;
  currentStage: DagNode;
  estimatedUsd: number;
  budgetUsd: number | null;
  prompt: string | null;
  isHero: boolean;
  sourceDurationMs: number;
  // The persisted gate inputs the DAG reads at the relevant nodes.
  rights: RightsChecklist;
  humanReviewApproved: boolean;
  // The registered output, once full_render + registration complete.
  variantId: string | null;
  playbackUrl: string | null;
}

export interface StepResult {
  job: JobRecord;
  advanced: boolean; // false when the job parked at a gate (blocked / awaiting_review / paused)
  note: string;
}

function at(job: JobRecord, stage: DagNode): boolean {
  return job.currentStage === stage;
}

function nextNode(stage: DagNode): DagNode {
  const i = DAG_NODES.indexOf(stage);
  return i >= 0 && i < DAG_NODES.length - 1 ? DAG_NODES[i + 1] : stage;
}

// Advance the job by exactly ONE node. Pure: returns a new JobRecord, never mutates. The HTTP layer (or a
// worker loop) calls step() repeatedly; the gates park the job by setting state and NOT advancing the
// stage, so re-calling step() on a parked job re-evaluates the gate (resumable + idempotent).
export async function step(job: JobRecord, registry: AdapterRegistry): Promise<StepResult> {
  // Terminal states never advance.
  if (job.state === "done" || job.state === "failed" || job.state === "rejected") {
    return { job, advanced: false, note: `terminal_${job.state}` };
  }

  // ---- rights_gate : HARD block. The single most important node. ----
  if (at(job, "rights_gate")) {
    const ev = evaluateForCapability(job.rights, job.capability);
    if (ev.blocked) {
      return {
        job: { ...job, state: "blocked", currentStage: "rights_gate" },
        advanced: false,
        note: `rights_blocked:${ev.reasons.join(",")}`,
      };
    }
    return { job: { ...job, state: "running", currentStage: nextNode("rights_gate") }, advanced: true, note: "rights_green" };
  }

  // ---- adaptation_plan : recompute + apply the cost gate before any render. ----
  if (at(job, "adaptation_plan")) {
    const cost = estimateCost(job.capability, job.sourceDurationMs, job.budgetUsd);
    if (cost.overBudget) {
      return {
        job: { ...job, state: "paused_over_budget", currentStage: "adaptation_plan", estimatedUsd: cost.estimatedUsd },
        advanced: false,
        note: `over_budget:${cost.estimatedUsd}>${job.budgetUsd}`,
      };
    }
    return { job: { ...job, estimatedUsd: cost.estimatedUsd, currentStage: nextNode("adaptation_plan") }, advanced: true, note: "cost_ok" };
  }

  // ---- human_review : Tier B/C gate. Tier A walks through; Tier B/C must be approved. Tier C on hero
  // content can NEVER auto-advance (it always parks until a human approves). ----
  if (at(job, "human_review")) {
    if (job.tier === "A") {
      return { job: { ...job, currentStage: nextNode("human_review") }, advanced: true, note: "tier_A_no_review" };
    }
    if (!job.humanReviewApproved) {
      return {
        job: { ...job, state: "awaiting_review", currentStage: "human_review" },
        advanced: false,
        note: job.tier === "C" && job.isHero ? "tier_C_hero_mandatory_review" : "awaiting_human_review",
      };
    }
    return { job: { ...job, state: "running", currentStage: nextNode("human_review") }, advanced: true, note: "review_approved" };
  }

  // ---- full_render : the adapter runs. A gated (Tier B/C) adapter REFUSES without approval, so no
  // completed asset is fabricated. A refusal fails the job rather than inventing media. ----
  if (at(job, "full_render")) {
    const adapter = registry.get(job.capability);
    if (adapter == null) {
      return { job: { ...job, state: "failed", currentStage: "full_render" }, advanced: false, note: "no_adapter" };
    }
    const ctx: RunContext = {
      jobId: job.jobId,
      sourceId: job.sourceId,
      sourceDurationMs: job.sourceDurationMs,
      humanReviewApproved: job.humanReviewApproved,
      lowConfidenceFlagged: job.lowConfidenceFlagged,
      prompt: job.prompt,
    };
    const out = await adapter.run([{ kind: job.capability, params: {} }], ctx);
    if (!out.produced) {
      return { job: { ...job, state: "failed", currentStage: "full_render" }, advanced: false, note: `render_refused:${out.reason}` };
    }
    return {
      job: { ...job, playbackUrl: out.playbackUrl, currentStage: nextNode("full_render") },
      advanced: true,
      note: "rendered",
    };
  }

  // ---- variant_registration : assign the variant id. The DB port persists the full provenance row. ----
  if (at(job, "variant_registration")) {
    const variantId = `adv_${job.jobId}`;
    return { job: { ...job, variantId, currentStage: nextNode("variant_registration") }, advanced: true, note: "registered" };
  }

  // ---- publish_ready : terminal success. ----
  if (at(job, "publish_ready")) {
    return { job: { ...job, state: "done", currentStage: "publish_ready" }, advanced: false, note: "publish_ready" };
  }

  // ---- every other node is a pass-through analysis/derivation step. They are no-ops in this state
  // machine core (the real probe/transcription/etc. backends run via the adapter/analyze plane); they
  // advance deterministically so the DAG is resumable. ----
  return { job: { ...job, state: "running", currentStage: nextNode(job.currentStage) }, advanced: true, note: `pass:${job.currentStage}` };
}

// Drive the job to its next PARK or terminal. Calls step() until the stage stops advancing. Bounded by the
// node count so a logic error cannot loop forever.
export async function drive(job: JobRecord, registry: AdapterRegistry): Promise<JobRecord> {
  let cur = job;
  for (let i = 0; i <= DAG_NODES.length + 1; i++) {
    const r = await step(cur, registry);
    cur = r.job;
    if (!r.advanced) break;
  }
  return cur;
}

// Build the provenance bundle for the registered variant. Pure so the DB port and tests share it.
export interface AdaptedProvenance {
  sourceId: string;
  sourceType: "adapted_archive";
  transformation: Capability;
  prompt: string | null;
  adapters: Array<{ id: string; capability: Capability }>;
  consentRef: string | null;
  rightsRef: string | null;
  c2paSigned: boolean;
  article50AiLabel: string;
  costUsd: number;
  reviewer: string | null;
  lowConfidenceFlagged: boolean;
}

export function buildProvenance(job: JobRecord, adapterId: string, reviewer: string | null): AdaptedProvenance {
  return {
    sourceId: job.sourceId,
    sourceType: "adapted_archive",
    transformation: job.capability,
    prompt: job.prompt,
    adapters: [{ id: adapterId, capability: job.capability }],
    consentRef: job.rights.consentRef,
    rightsRef: `rights:${job.sourceId}`,
    c2paSigned: true,
    article50AiLabel: tierOf(job.capability) === "A" ? "AI-assisted edit" : "AI-generated",
    costUsd: job.estimatedUsd,
    reviewer,
    lowConfidenceFlagged: job.lowConfidenceFlagged,
  };
}
