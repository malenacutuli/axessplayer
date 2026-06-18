// The RIGHTS / CONSENT GATE: a HARD block before ANY adaptation (prompt 23). No bytes are touched, no
// adapter runs, until this gate is GREEN. The checklist:
//   - own / control the footage
//   - actor adaptation rights
//   - voice rights
//   - likeness rights
//   - music rights
//   - territory cleared
//   - brand / logo cleared
//   - AI-transformation allowed by the underlying agreement
//   - age-sensitive content reviewed
// plus the consent-ledger linkage (consent_ref + consent_current).
//
// overall = GREEN  : every required box is checked AND consent is current. Adaptation may proceed.
//           YELLOW : the hard-required boxes are checked but a soft box is open (e.g. music or brand not
//                    cleared); the offending capability is blocked, others may proceed under review.
//           RED    : a hard-required box is unchecked. NOTHING proceeds.
//
// CONSENT: a likeness/voice-touching capability (tiers.ts LIKENESS_CAPABILITIES) requires consent_current.
// A REVOCATION (consent_current=false on a previously green source) flips the gate and triggers a purge
// of the adapted variants (purgeOnRevocation). The consent ledger itself is owned by services/trust; this
// module talks to it ONLY through the ConsentLedger interface (no import of the live service). No em dashes.

import type { Capability } from "./tiers.js";
import { touchesLikeness } from "./tiers.js";

export type RightsColor = "green" | "yellow" | "red";

// The checklist as stored on adaptation_rights_gate. All default false (closed) so a brand-new source is
// RED until a human fills the gate.
export interface RightsChecklist {
  ownsFootage: boolean;
  actorAdaptationRights: boolean;
  voiceRights: boolean;
  likenessRights: boolean;
  musicRights: boolean;
  territoryCleared: boolean;
  brandLogoCleared: boolean;
  aiTransformationAllowed: boolean;
  ageSensitiveReviewed: boolean;
  consentRef: string | null;
  consentCurrent: boolean;
}

export interface RightsEvaluation {
  overall: RightsColor;
  blocked: boolean; // true unless overall === 'green' for the requested capability
  reasons: string[]; // the unchecked / failing items, for the operator
}

// Wired to the consent ledger by interface. Production injects a services/trust-backed client; tests
// inject a fake. checkCurrent answers: is the consent for this source/subject currently granted (not
// revoked, not expired)?
export interface ConsentLedger {
  checkCurrent(consentRef: string): Promise<boolean>;
}

// HARD-required boxes: an unchecked box here is always RED. Owning the footage and the agreement
// permitting AI transformation are non-negotiable preconditions for any adaptation at all.
const HARD_REQUIRED: Array<[keyof RightsChecklist, string]> = [
  ["ownsFootage", "footage_not_owned_or_controlled"],
  ["aiTransformationAllowed", "ai_transformation_not_permitted"],
  ["ageSensitiveReviewed", "age_sensitive_not_reviewed"],
];

// SOFT boxes: an unchecked box here is YELLOW (the source can still produce some variants, but the
// capability that depends on the box is blocked). Mapped to the capabilities they gate below.
const SOFT_BOXES: Array<[keyof RightsChecklist, string]> = [
  ["actorAdaptationRights", "actor_adaptation_rights_missing"],
  ["voiceRights", "voice_rights_missing"],
  ["likenessRights", "likeness_rights_missing"],
  ["musicRights", "music_rights_missing"],
  ["territoryCleared", "territory_not_cleared"],
  ["brandLogoCleared", "brand_logo_not_cleared"],
];

// Evaluate the overall color from the checklist alone (capability-agnostic). RED if any hard box is open;
// YELLOW if all hard boxes pass but a soft box is open; GREEN otherwise. Consent currency is folded in:
// a stale consent forces at least YELLOW (a likeness/voice action will then be blocked per-capability).
export function evaluateOverall(c: RightsChecklist): RightsColor {
  for (const [k] of HARD_REQUIRED) {
    if (!c[k]) return "red";
  }
  const anySoftOpen = SOFT_BOXES.some(([k]) => !c[k]);
  if (anySoftOpen) return "yellow";
  if (c.consentRef != null && !c.consentCurrent) return "yellow";
  return "green";
}

// Evaluate the gate for a SPECIFIC capability. This is the per-job decision. A capability that touches
// likeness/voice additionally requires the matching rights box AND current consent; otherwise it is
// BLOCKED even when the overall color is green/yellow for other work.
export function evaluateForCapability(c: RightsChecklist, capability: Capability): RightsEvaluation {
  const reasons: string[] = [];
  const overall = evaluateOverall(c);

  for (const [k, reason] of HARD_REQUIRED) {
    if (!c[k]) reasons.push(reason);
  }

  if (touchesLikeness(capability)) {
    if (!c.likenessRights && (capability === "actor_replacement" || capability === "wardrobe_redress" || capability === "identity_across_clips" || capability === "lip_sync")) {
      reasons.push("likeness_rights_missing");
    }
    if (!c.voiceRights && (capability === "dub" || capability === "lip_sync")) {
      reasons.push("voice_rights_missing");
    }
    if (!c.actorAdaptationRights) {
      reasons.push("actor_adaptation_rights_missing");
    }
    // No likeness/voice adaptation without CURRENT consent. A missing or stale consent is a hard block
    // for these capabilities even if the boxes are checked.
    if (c.consentRef == null) reasons.push("consent_reference_missing");
    else if (!c.consentCurrent) reasons.push("consent_revoked_or_expired");
  }

  // Music / brand clearances gate only the capabilities that depend on them.
  if (capability === "static_surface_placement" && !c.brandLogoCleared) reasons.push("brand_logo_not_cleared");

  const blocked = overall === "red" || reasons.length > 0;
  return { overall, blocked, reasons: dedupe(reasons) };
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

// Refresh consent currency from the ledger and fold it into the checklist. Called at the rights_gate DAG
// node so a revocation that happened AFTER the gate was filled is caught before any render.
export async function refreshConsent(c: RightsChecklist, ledger: ConsentLedger): Promise<RightsChecklist> {
  if (c.consentRef == null) return { ...c, consentCurrent: false };
  const current = await ledger.checkCurrent(c.consentRef);
  return { ...c, consentCurrent: current };
}

// REVOCATION purge: given the variants produced from a source whose consent was revoked, return the set
// to purge. Every adapted variant carrying that source's likeness/voice transformation must go. The
// caller (the DB port) performs the delete; this stays pure so it unit-tests.
export interface PurgeableVariant {
  variantId: string;
  transformation: Capability;
}

export function purgeOnRevocation(variants: PurgeableVariant[]): string[] {
  // A revocation removes the right to use the person at all, so every likeness/voice-derived variant is
  // purged. Non-likeness variants (a vertical reframe of b-roll, a poster) survive.
  return variants.filter((v) => touchesLikeness(v.transformation)).map((v) => v.variantId);
}
