// Structured scene-spec composer (Studio "Compose scene", sourced from Showrunner CI). Creators pick from a
// CONTROLLED VOCABULARY (set, consented characters, action, blocking, prop, style) instead of a blank prompt
// box, and the engine produces a ShotPromptSpec that promptcraft renders into the chosen provider's idiom with
// the style-correct negative. Two wins for free: no blank box, and every scene is tagged by construction (the
// variant_axis the decision engine and Scene Genome need).
//
// The HARD LINE vs Showrunner (CI9): the character picker is gated by consent at SELECTION time. A character
// that does not resolve to a current consent_ledger entry CANNOT be composed, by construction. No unconsented
// likeness, ever. No em dashes.

import { formatPrompt, type DialogueLine, type FormattedPrompt, type ShotPromptSpec, type VideoProvider } from "./promptcraft.js";
import { findStyle } from "./promptGallery.js";
import { resolveCast, type CharacterBinding } from "./agents.js";
import type { ConsentGate } from "./consentGate.js";

// A series is a persistent world: registered locations, a CONSENTED character roster, a prop library, the
// allowed action/blocking vocabulary, and a default style. Composed scenes reference these and extend them.
export interface SeriesWorld {
  seriesId: string;
  locations: Array<{ id: string; label: string; description: string }>;
  roster: Record<string, CharacterBinding>; // characterId -> binding (carries consentRef + realLikeness)
  props: Array<{ id: string; label: string }>;
  allowedActions: string[]; // the beat's curated action vocabulary, extensible per series
  allowedBlocking: string[]; // enters/exits, single/group, ...
  defaultStyleId?: string;
}

// One composed shot, every field a controlled-vocabulary selection (ids resolve against the world), plus
// optional free-text dialogue (the only free field, moderated + routed through the Writer downstream).
export interface SceneSelection {
  settingId: string;
  characterIds: string[];
  action: string;
  blocking?: string;
  propIds?: string[];
  styleId?: string;
  dialogue?: DialogueLine[];
  pov?: string; // the variant axis the decision engine keys on (e.g. a character POV)
  intensity?: number; // 1..5 variant axis
  provider?: VideoProvider; // default ltx
}

export class CompositionError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`scene cannot be composed: ${reasons.join("; ")}`);
    this.name = "CompositionError";
    this.reasons = reasons;
  }
}

export interface ComposedScene {
  spec: ShotPromptSpec;
  formatted: FormattedPrompt; // the finished provider-correct prompt + the style-correct negative
  // The persistence payload for a decision-engine-ready beat_variant: the variant axes are filled in, so the
  // scene is analytics-tagged and selectable by the bandit from the moment it is created.
  variant: { pov: string | null; intensity: number; tags: Record<string, unknown> };
  cast: CharacterBinding[]; // the resolved, consented roster used
}

// Compose one scene from controlled-vocabulary selections. Validates every selection against the world,
// CONSENT-GATES the characters (rejects any without a current consent_ledger entry), builds the ShotPromptSpec
// with the gallery style + its look-correct negative, and renders the provider prompt. Throws CompositionError
// with the offending reasons (e.g. an unconsented or unknown character) so the picker can surface them.
export async function composeScene(selection: SceneSelection, world: SeriesWorld, deps: { consent: ConsentGate }): Promise<ComposedScene> {
  const reasons: string[] = [];
  const provider = selection.provider ?? "ltx";

  // 1. Vocabulary checks: a selection outside the world is rejected (no free-text smuggling).
  const setting = world.locations.find((l) => l.id === selection.settingId);
  if (!setting) reasons.push(`unknown setting ${selection.settingId}`);
  if (!selection.action || (world.allowedActions.length > 0 && !world.allowedActions.includes(selection.action))) {
    reasons.push(`action not in the series vocabulary: ${selection.action || "(empty)"}`);
  }
  if (selection.blocking && world.allowedBlocking.length > 0 && !world.allowedBlocking.includes(selection.blocking)) {
    reasons.push(`blocking not in vocabulary: ${selection.blocking}`);
  }
  const props = (selection.propIds ?? []).map((id) => world.props.find((p) => p.id === id) ?? null);
  props.forEach((p, i) => { if (!p) reasons.push(`unknown prop ${selection.propIds![i]}`); });
  if (selection.characterIds.length === 0) reasons.push("at least one character is required");

  // 2. CONSENT GATE at selection time (the hard line): every character must resolve to a current consent
  // record. resolveCast checks real-likeness consent and unknown bindings; we block on any not-bound character.
  const cast = await resolveCast(selection.characterIds, world.roster, deps.consent);
  for (const b of cast.blocked) {
    reasons.push(b.reason === "consent_required" ? `character ${b.name} has no current consent (unselectable)` : `unknown character ${b.name}`);
  }

  if (reasons.length > 0) throw new CompositionError(reasons);

  // 3. Build the ShotPromptSpec from the controlled vocabulary + the gallery style.
  const style = selection.styleId ? findStyle(selection.styleId) : world.defaultStyleId ? findStyle(world.defaultStyleId) : undefined;
  const subject = cast.bound.map((b) => `${b.name}${b.descriptor ? ` (${b.descriptor})` : ""}`).join(", ");
  const blockingClause = selection.blocking ? `, ${selection.blocking}` : "";
  const propClause = props.length > 0 ? ` with ${props.map((p) => p!.label).join(", ")}` : "";
  const spec: ShotPromptSpec = {
    action: `${selection.action}${blockingClause}${propClause}`,
    subject,
    scene: setting!.description,
    style: style?.styleLine,
    negative: style?.negative,
    camera: style?.cameraBias,
    dialogue: selection.dialogue,
    aspect: "9:16",
  };
  const formatted = formatPrompt(spec, provider);

  return {
    spec,
    formatted,
    variant: {
      pov: selection.pov ?? null,
      intensity: clampIntensity(selection.intensity),
      // the variant_axis tags the decision engine + Scene Genome read: which world assets this scene used.
      tags: {
        setting_id: selection.settingId,
        character_ids: cast.bound.map((b) => b.name),
        action: selection.action,
        prop_ids: selection.propIds ?? [],
        style_id: style?.id ?? null,
        provider,
        composed: true,
      },
    },
    cast: cast.bound,
  };
}

function clampIntensity(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 3; // server default
  return Math.max(1, Math.min(5, Math.round(n)));
}
