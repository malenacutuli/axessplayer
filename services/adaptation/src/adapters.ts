// The OPEN ADAPTER INTERFACE. Vendors are NOT hardcoded: an adapter binds a capability to an
// implementation through this contract, and the registry resolves a capability to its adapter. Swapping
// a vendor is registering a different adapter for the same capability id; nothing else changes.
//
//   AdaptationAdapter {
//     id          : a stable identifier for provenance ("builtin.vertical_reframe", a vendor key, ...)
//     capability  : the single capability this adapter implements
//     estimate    : cost-before-commit estimate for an instruction set
//     validate    : preflight the instructions (cheap, no spend); returns ok or a reason
//     run         : produce the variant; MUST refuse for Tier B/C without a human review + low-conf flag
//   }
//
// THE GOVERNING RULE is enforced in run(): Tier A adapters apply a constrained edit to existing pixels;
// Tier B/C adapters NEVER fabricate a completed asset on their own. A generative (Tier B/C) adapter that
// is called without an approved human review returns a REFUSAL, not an asset. This is the guarantee that
// an unwired generative adapter never produces a finished variant. No em dashes.

import type { Capability, Tier } from "./tiers.js";
import { tierOf } from "./tiers.js";
import { estimateCost, type CostEstimate } from "./cost.js";

export interface AdapterInstruction {
  kind: string;
  params: Record<string, unknown>;
  sceneId?: string;
}

// The context a run receives. humanReviewApproved is the gate signal: it is true ONLY when an
// adaptation_review row with decision='approved' exists for the job. lowConfidenceFlagged rides through
// to provenance. sourceDurationMs feeds the estimate.
export interface RunContext {
  jobId: string;
  sourceId: string;
  sourceDurationMs: number;
  humanReviewApproved: boolean;
  lowConfidenceFlagged: boolean;
  prompt?: string | null;
}

export type ValidateResult = { ok: true } | { ok: false; reason: string };

// run() returns EITHER a produced asset OR a refusal. A refusal is the ONLY thing a gated generative
// adapter may return when its human gate is not satisfied; it can never invent a playbackUrl.
export type RunResult =
  | { produced: true; playbackUrl: string; appliedInstructions: number; editedExistingPixels: boolean }
  | { produced: false; refused: true; reason: string };

export interface AdaptationAdapter {
  readonly id: string;
  readonly capability: Capability;
  estimate(instructions: AdapterInstruction[], ctx: { sourceDurationMs: number; budgetUsd: number | null }): CostEstimate;
  validate(instructions: AdapterInstruction[]): ValidateResult;
  run(instructions: AdapterInstruction[], ctx: RunContext): Promise<RunResult>;
}

// Shared estimate: every adapter prices the same way (per-minute of source by capability). Kept here so a
// new adapter does not reimplement it.
function defaultEstimate(
  capability: Capability,
  ctx: { sourceDurationMs: number; budgetUsd: number | null },
): CostEstimate {
  return estimateCost(capability, ctx.sourceDurationMs, ctx.budgetUsd);
}

// ---------------------------------------------------------------------------------------------------
// Tier A : reliable, one-click adapters. They apply a constrained, deterministic edit to existing pixels
// or derive metadata. They never synthesize a person. run() succeeds without a human gate (the tier is
// reliable), producing a deterministic in-pipeline playback url marker (the real media write is the
// generation/ingestion plane's job; this service plans and registers the edit). No em dashes.
// ---------------------------------------------------------------------------------------------------

function tierAUrl(capability: Capability, sourceId: string): string {
  // A deterministic, clearly-derived marker. NOT a fabricated external asset: it encodes the source and
  // the edit so provenance is explicit. The media plane resolves this to bytes.
  return `adapted://${sourceId}/${capability}`;
}

function makeTierAAdapter(capability: Capability): AdaptationAdapter {
  if (tierOf(capability) !== "A") throw new Error(`makeTierAAdapter: ${capability} is not Tier A`);
  return {
    id: `builtin.${capability}`,
    capability,
    estimate: (_ins, ctx) => defaultEstimate(capability, ctx),
    validate: (instructions) => {
      if (instructions.length === 0) return { ok: false, reason: "no_instructions" };
      return { ok: true };
    },
    async run(instructions, ctx) {
      if (instructions.length === 0) return { produced: false, refused: true, reason: "no_instructions" };
      // Tier A edits existing pixels / derives metadata. Reliable, one-click, no human gate required.
      return {
        produced: true,
        playbackUrl: tierAUrl(capability, ctx.sourceId),
        appliedInstructions: instructions.length,
        editedExistingPixels: true,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Tier B / C : gated adapters. They are STUBS that REFUSE unless an approved human review is present, and
// even then they only mark a constrained edit (Tier B) or remain low-confidence-flagged (Tier C). A Tier
// C adapter additionally refuses if it was not low-confidence-flagged (a Tier C action must always carry
// the flag) so the pipeline cannot accidentally route hero content through it unreviewed. No em dashes.
// ---------------------------------------------------------------------------------------------------

function makeGatedAdapter(capability: Capability, tier: Tier): AdaptationAdapter {
  return {
    id: `gated.${capability}`,
    capability,
    estimate: (_ins, ctx) => defaultEstimate(capability, ctx),
    validate: (instructions) => {
      if (instructions.length === 0) return { ok: false, reason: "no_instructions" };
      return { ok: true };
    },
    async run(instructions, ctx) {
      // HARD: a generative / gated adapter NEVER fabricates a completed asset without an approved human
      // review. This is the line that keeps an unwired adapter honest.
      if (!ctx.humanReviewApproved) {
        return { produced: false, refused: true, reason: `tier_${tier}_requires_human_review` };
      }
      if (tier === "C" && !ctx.lowConfidenceFlagged) {
        return { produced: false, refused: true, reason: "tier_C_must_be_low_confidence_flagged" };
      }
      // Even WITH approval, the built-in gated adapter does not have a real generative backend wired. It
      // refuses to invent media; a real vendor adapter registered for this capability would produce here.
      return { produced: false, refused: true, reason: `no_generative_backend_wired_for_${capability}` };
    },
  };
}

// The registry. Resolves a capability to its adapter. Production registers vendor adapters by overwriting
// an entry; tests register fakes. The default registry ships reliable Tier A adapters and gated Tier B/C
// stubs.
export class AdapterRegistry {
  private readonly byCapability = new Map<Capability, AdaptationAdapter>();

  register(adapter: AdaptationAdapter): void {
    this.byCapability.set(adapter.capability, adapter);
  }

  get(capability: Capability): AdaptationAdapter | null {
    return this.byCapability.get(capability) ?? null;
  }

  has(capability: Capability): boolean {
    return this.byCapability.has(capability);
  }
}

// Build the default registry: Tier A reliable, Tier B/C gated stubs. No vendor is hardcoded; these are
// the built-in baseline an integrator extends.
export function defaultRegistry(): AdapterRegistry {
  const r = new AdapterRegistry();
  for (const cap of ["vertical_reframe", "cut", "repace", "transcription", "captioning", "audio_description", "dub", "poster", "trailer", "logo_blur"] as Capability[]) {
    r.register(makeTierAAdapter(cap));
  }
  for (const cap of ["static_surface_placement", "lip_sync", "object_removal", "pov_from_existing_shots"] as Capability[]) {
    r.register(makeGatedAdapter(cap, "B"));
  }
  for (const cap of ["wardrobe_redress", "actor_replacement", "new_scene", "identity_across_clips"] as Capability[]) {
    r.register(makeGatedAdapter(cap, "C"));
  }
  return r;
}

export { makeTierAAdapter, makeGatedAdapter };
