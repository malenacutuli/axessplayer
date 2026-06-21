# Build note: structured scene-spec composer for the Studio

**Adds to prompt 22 (creator studio build). Sourced from Showrunner CI (GOLD_STANDARD_05, CI8). June 2026. No em dashes.**

## Why
Showrunner's `/scene` interface lets creators compose a shot from a fixed, controlled vocabulary (set, characters,
action, blocking, prop, filter) and the engine renders it reliably. Two wins come for free from this design: creators
do not face a blank prompt box, and every scene is tagged by construction, which is exactly the structured signal the
decision engine and the Scene Genome need. Axessplayer already has this structure in `mobile.beat_variants`
(variant_axis) and in the new promptcraft ShotPromptSpec. This note exposes it as an authoring UI and wires it to the
clean prompt grammar already shipped.

## What to build (Studio Create, additive to prompt 22)
A "Compose scene" mode alongside the existing free-text and Create-with-AI flows. The composer is a set of
controlled-vocabulary selectors that produce a `ShotPromptSpec`, which formatPrompt renders into the chosen
provider's idiom (promptcraft.ts) with the style-correct negative (promptGallery.ts).

Selectors (each backed by a controlled vocabulary, not free text):
- Setting / set: from the series world's registered locations (one persistent universe per series, see below).
- Characters: from the series' registered, CONSENTED character roster only. The picker must reject anyone without a
  consent_ledger entry. This is the hard line that separates Axessplayer from Showrunner: no unconsented likeness can
  be selected, by construction.
- Action: a curated vocabulary (the beat's allowed actions), extensible per series.
- Blocking / walking: enters/exits, single/group.
- Prop: from the series prop library.
- Style / filter: from the prompt gallery presets (anime-noir, claymation, comic-cel, etc.), which carry the
  look-correct negative so an animated show never gets a photoreal negative.
- Dialogue: optional free text; if present, routed through the Writer with the DRAMATIC_OPERATORS (hook, reversal,
  foreshadow, cliffhanger).

Output: a `ShotPromptSpec` per shot, each carrying the finished provider-correct prompt and the right negative, ready
for the router. The composed scene persists as a beat_variant with its variant_axis filled in (so it is decision-engine
ready and analytics-tagged from the moment it is created).

## Persistent universe plus remix (the second Showrunner borrow)
Let a series be a persistent world: a registered set of locations, a consented character roster, a prop library, and
a style. Creators (and viewers, later) compose new scenes within it and extend it. This is Showrunner's most engaging
loop, minus the celebrity-deepfake liability, because the roster is consented original characters. Model it as: series
owns world assets; beats/variants reference them; a new composed scene is a new beat_variant in that world.

## Guardrails (the differentiators, do not skip)
- Consent gate at selection time: characters and likenesses must resolve to a consent_ledger entry or they cannot be
  picked. Showrunner's whole exposure (CI9) comes from not doing this.
- Every rendered output stays C2PA-signed and Article 50 labeled, as the generation plane already does.
- Moderation hook on free-text dialogue and prompt fields before render (Showrunner ships none; the logs contain
  defamatory and edgy user content). Gate minors and disallowed content upstream of generation.
- Reliability: route composed multi-scene episodes through the existing stitch + FLF chaining + consistency QA path,
  and treat stitch success rate as a tracked metric. Showrunner's combine step fails often (CI10); this is where to
  be visibly better.

## Definition of done
From the Studio, a creator composes a scene by selecting set, consented characters, action, blocking, prop, and style,
optionally adds dialogue, and gets a rendered shot whose prompt was built by promptcraft for the chosen provider with
the correct negative, persisted as a beat_variant with a filled variant_axis, consent-checked, C2PA-signed, and Article
50 labeled. Unconsented characters are unselectable. Composed scenes can be combined into an episode through the
existing stitch pipeline.
