// Generation-time placement selector. placeFill(slot, candidates, viewerCtx) chooses a region-addressable
// branded variant using the slot's GROUND-TRUTH geometry/lighting/surface metadata (no CV, no tracking) +
// the campaign targeting, runs the brand-safety + canon-safety HARD filters FIRST (a blocked pairing never
// fills), and emits a fill carrying C2PA signing, Article 50 disclosure (where personalized), and a full
// immutable audit record. No em dashes.

import { checkFillAllowed } from "./safety.js";
import type {
  AuditRecord,
  BrandCampaign,
  FillCandidate,
  PlacementSlot,
  Targeting,
  ViewerContext,
} from "./types.js";
import type { DemandAdapter } from "./demand.js";

export type PlaceResult =
  | {
      filled: true;
      fill: {
        slotId: string;
        campaignId: string;
        region: string;
        viewerHash?: string;
        creativeRef: string;
        c2paSigned: boolean;
        article50: boolean;
        audit: AuditRecord;
      };
      propensity: number;
    }
  | { filled: false; blocked: true; reason: string };

// TARGETING match (allow lists). A candidate's campaign must target the viewer's country/language/
// demographic/genre when the campaign declares them. excludeCharacters/excludeScenes are enforced against
// the slot's ground-truth scene context. Returns false to drop the candidate before selection.
export function targetingMatches(t: Targeting, viewer: ViewerContext, slot: PlacementSlot): boolean {
  const allowOk = (allow: string[] | undefined, value: string | undefined): boolean =>
    !allow || allow.length === 0 || (value != null && allow.includes(value));
  if (!allowOk(t.country, viewer.country)) return false;
  if (!allowOk(t.language, viewer.language)) return false;
  if (!allowOk(t.demographic, viewer.demographic)) return false;
  if (!allowOk(t.genre, viewer.genre)) return false;
  // Scene/character exclusions read the slot ground-truth metadata (authored, not CV).
  const sceneId = String(slot.groundTruthMetadata["sceneId"] ?? slot.beatId);
  if ((t.excludeScenes ?? []).includes(sceneId)) return false;
  const characters = (slot.groundTruthMetadata["characters"] as string[] | undefined) ?? [];
  if ((t.excludeCharacters ?? []).some((ch) => characters.includes(ch))) return false;
  return true;
}

export type PlaceFillDeps = {
  // Resolve a campaign for a candidate (targeting, exclusions, approval gate).
  campaignFor: (campaignId: string) => BrandCampaign | undefined;
  demand: DemandAdapter;
  // Frequency cap: how many times this campaign has already filled for this viewer.
  fillCountForViewer?: (campaignId: string, viewerHash: string) => number;
  // C2PA signer (injected; a real signer produces a manifest hash). Defaults to a deterministic stub.
  sign?: (creativeRef: string, audit: AuditRecord) => boolean;
  now?: () => string;
};

// Core selector. Order is load-bearing: HARD safety filters reject disallowed brand/context pairings BEFORE
// anything else, then targeting + frequency caps, then the licensed demand adapter selects among the
// eligible, ground-truth-bound candidates. The output fill is C2PA-signed, Article-50 disclosed (where the
// creative is personalized), and carries a full audit record. Returns blocked+reason when nothing is safe.
export async function placeFill(
  slot: PlacementSlot,
  candidates: FillCandidate[],
  viewerCtx: ViewerContext,
  deps: PlaceFillDeps,
): Promise<PlaceResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const sign = deps.sign ?? (() => true);

  if (candidates.length === 0) return { filled: false, blocked: true, reason: "no candidates" };

  const safetyReasons: string[] = [];
  const eligible: FillCandidate[] = [];
  for (const cand of candidates) {
    const campaign = deps.campaignFor(cand.campaignId);
    if (!campaign) {
      safetyReasons.push(`campaign ${cand.campaignId} not found`);
      continue;
    }
    // Approval + status gate: only an approved, active campaign may fill.
    if (campaign.approvalState !== "approved" || campaign.status !== "active") {
      safetyReasons.push(`campaign ${cand.campaignId} not approved/active`);
      continue;
    }
    // HARD brand-safety + canon-safety + ground-truth surface fit. Fails closed.
    const allowed = checkFillAllowed(cand, slot, campaign.targeting.excludeCategories ?? []);
    if (!allowed.ok) {
      safetyReasons.push(...allowed.reasons);
      continue;
    }
    // Targeting allow lists + scene/character exclusions.
    if (!targetingMatches(campaign.targeting, viewerCtx, slot)) {
      safetyReasons.push(`campaign ${cand.campaignId} targeting does not match viewer/scene`);
      continue;
    }
    // Frequency cap per viewer.
    if (viewerCtx.viewerHash && deps.fillCountForViewer) {
      const seen = deps.fillCountForViewer(cand.campaignId, viewerCtx.viewerHash);
      if (campaign.freqCapPerViewer > 0 && seen >= campaign.freqCapPerViewer) {
        safetyReasons.push(`campaign ${cand.campaignId} frequency cap reached`);
        continue;
      }
    }
    // Budget gate: a campaign with no remaining budget cannot fill.
    if (campaign.budgetCents > 0 && campaign.spentCents >= campaign.budgetCents) {
      safetyReasons.push(`campaign ${cand.campaignId} budget exhausted`);
      continue;
    }
    eligible.push(cand);
  }

  if (eligible.length === 0) {
    return { filled: false, blocked: true, reason: safetyReasons[0] ?? "no eligible candidate" };
  }

  // Licensed demand rail selects among the eligible, ground-truth-bound candidates (no CV).
  const selected = await deps.demand.select(eligible, viewerCtx);
  if (!selected) return { filled: false, blocked: true, reason: "demand rail returned no fill" };

  const cand = selected.candidate;
  const campaign = deps.campaignFor(cand.campaignId)!;
  const audit: AuditRecord = {
    campaignId: campaign.id,
    brandId: campaign.brandId,
    creativeRef: cand.creativeRef,
    region: cand.region,
    targetingSnapshot: campaign.targeting,
    dealModel: campaign.dealModel,
    rateCents: campaign.rateCents,
    licensing: { demandRail: deps.demand.railName, license: deps.demand.license },
    provenance: { groundTruth: true, cv: false, signedAt: now() },
  };
  const c2paSigned = sign(cand.creativeRef, audit);
  const article50 = cand.personalized === true; // disclosed WHERE personalization applies

  return {
    filled: true,
    fill: {
      slotId: slot.id,
      campaignId: campaign.id,
      region: cand.region,
      ...(viewerCtx.viewerHash ? { viewerHash: viewerCtx.viewerHash } : {}),
      creativeRef: cand.creativeRef,
      c2paSigned,
      article50,
      audit,
    },
    propensity: selected.propensity,
  };
}
