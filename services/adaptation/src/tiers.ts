// Reliability tiers and the capability taxonomy for AI live-action adaptation (prompt 23,
// GOLD_STANDARD_15). THE GOVERNING RULE: edit existing pixels, do not regenerate, wherever possible.
//
//   Tier A : reframe / cut / repace / transcript / captions / AD / dub / poster / trailer / logo-blur.
//            Reliable and ONE-CLICK. These edit existing pixels or derive metadata; no synthesis of a
//            person.
//   Tier B : placement on static surfaces, lip-sync, object removal, POV-from-existing-shots. Needs QA
//            plus a human gate. Edits pixels but with enough ambiguity that a human signs off.
//   Tier C : wardrobe re-dress, actor replacement, new scenes, identity across many clips. Renders ONLY
//            behind a preview plus a MANDATORY human review, always low-confidence-flagged, and NEVER
//            auto on hero content. This is the heaviest legal and creative liability.
//
// No vendor is named here: a capability maps to a tier and a confidence band, not to an adapter. The
// open AdaptationAdapter interface (adapters.ts) binds a capability to an implementation. No em dashes.

export type Tier = "A" | "B" | "C";
export type Confidence = "high" | "medium" | "low";

// The canonical capability set. Adding a capability here without a tier mapping is a type error in
// CAPABILITY_TIER below, so the taxonomy cannot drift.
export type Capability =
  // Tier A
  | "vertical_reframe"
  | "cut"
  | "repace"
  | "transcription"
  | "captioning"
  | "audio_description"
  | "dub"
  | "poster"
  | "trailer"
  | "logo_blur"
  // Tier B
  | "static_surface_placement"
  | "lip_sync"
  | "object_removal"
  | "pov_from_existing_shots"
  // Tier C
  | "wardrobe_redress"
  | "actor_replacement"
  | "new_scene"
  | "identity_across_clips";

export const CAPABILITY_TIER: Record<Capability, Tier> = {
  vertical_reframe: "A",
  cut: "A",
  repace: "A",
  transcription: "A",
  captioning: "A",
  audio_description: "A",
  dub: "A",
  poster: "A",
  trailer: "A",
  logo_blur: "A",
  static_surface_placement: "B",
  lip_sync: "B",
  object_removal: "B",
  pov_from_existing_shots: "B",
  wardrobe_redress: "C",
  actor_replacement: "C",
  new_scene: "C",
  identity_across_clips: "C",
};

export const ALL_CAPABILITIES = Object.keys(CAPABILITY_TIER) as Capability[];

export function isCapability(x: unknown): x is Capability {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(CAPABILITY_TIER, x);
}

// The tier a capability belongs to. Throws on an unknown capability so a typo never silently downgrades
// a Tier C action to an unreviewed path.
export function tierOf(capability: Capability): Tier {
  const t = CAPABILITY_TIER[capability];
  if (t == null) throw new Error(`unknown capability: ${capability}`);
  return t;
}

// Capabilities that touch a real person's likeness or voice. These NEVER proceed without current
// consent (the rights gate enforces likeness_rights / voice_rights + consent_current).
export const LIKENESS_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "lip_sync",
  "wardrobe_redress",
  "actor_replacement",
  "identity_across_clips",
  "dub",
]);

export function touchesLikeness(capability: Capability): boolean {
  return LIKENESS_CAPABILITIES.has(capability);
}
