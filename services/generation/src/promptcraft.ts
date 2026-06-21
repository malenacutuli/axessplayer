// REELM PROMPTCRAFT: one structured shot spec, formatted into each video model's house style. Every provider
// wants a different prompt shape, and getting it right is most of the quality. This encodes the documented
// best practices of LTX-2.3, Seedance, Veo 3, Runway, and Higgsfield (see docs/product/PROMPT_GALLERY.md for
// the sourced rules), so the Cinematographer agent emits a best-practice prompt for whichever model the router
// picks, without the creator (or the agent) memorizing five rule sets. No em dashes.
//
// Sources (verbatim rules + examples live in the gallery): LTX prompting guide (single flowing present-tense
// paragraph, quoted dialogue, no on-screen text); Seedance subject+action+scene+camera+lighting+style with
// explicit "Shot 1:/Shot 2:" multi-shot labels; Veo 3 [cinematography]+[subject]+[action]+[context]+[style],
// native audio via quoted dialogue + "(no subtitles)" + "SFX:" / "Ambient noise:", negatives as a separate
// comma list (never "no"/"don't"); Runway "[camera movement]: [establishing scene]. [details].", no negative
// phrasing; Higgsfield preset-owns-the-camera + a short subject/action prompt.

export type VideoProvider = "ltx" | "seedance" | "runway" | "veo" | "higgsfield";

export interface DialogueLine {
  speaker: string;
  line: string;
}

// The canonical, provider-agnostic description of one shot. The Cinematographer fills it; formatPrompt renders
// it. action is the only hard requirement (present tense, what visibly happens).
export interface ShotPromptSpec {
  action: string; // present-tense core action, what visibly happens (required)
  subject?: string; // main character/focal point + a concise fixed descriptor
  scene?: string; // setting / environment / context
  shot?: string; // framing + scale, e.g. "medium close, low angle"
  camera?: string; // movement, e.g. "slow push-in" (owned by the preset on Higgsfield)
  lighting?: string;
  mood?: string;
  style?: string; // the visual style line (usually from a gallery Style)
  dialogue?: DialogueLine[];
  sfx?: string[]; // sound effects (Veo/LTX native audio)
  ambient?: string; // ambient soundscape
  negative?: string[]; // unwanted items; handling is provider-specific (separate field vs dropped)
  aspect?: string; // "9:16" default
  preset?: string; // Higgsfield camera/scene preset name
}

export interface FormattedPrompt {
  provider: VideoProvider;
  prompt: string;
  negativePrompt?: string; // only set for providers with a real negative field (ltx, veo)
  preset?: string; // Higgsfield only
  aspect: string;
}

// Per-provider hard limits + defaults distilled from the docs. maxChars keeps us under each model's prompt
// ceiling (Runway ~1000). defaultNegative is the photoreal-leaning default; an animated style overrides it.
interface ProviderProfile {
  maxChars: number;
  fps: number;
  maxDurationS: number;
  hasNegativeField: boolean;
  nativeAudio: boolean;
  defaultNegative: string;
}

export const PROVIDER_PROFILES: Record<VideoProvider, ProviderProfile> = {
  // LTX-2.3: up to ~20s/call, native joint audio, the canonical photoreal negative (override for animation).
  ltx: { maxChars: 1500, fps: 24, maxDurationS: 20, hasNegativeField: true, nativeAudio: true, defaultNegative: "pc game, console game, video game, cartoon, childish, ugly, blurry, distorted, watermark, on-screen text" },
  // Seedance 2.0: 4-15s, 720p, native audio, strong camera-term adherence; no separate negative field in the API.
  seedance: { maxChars: 2000, fps: 24, maxDurationS: 15, hasNegativeField: false, nativeAudio: true, defaultNegative: "" },
  // Runway Gen-4: 5/10s, 24fps, NO negative phrasing supported at all.
  runway: { maxChars: 1000, fps: 24, maxDurationS: 10, hasNegativeField: false, nativeAudio: false, defaultNegative: "" },
  // Veo 3: 4/6/8s, native audio always on, negatives as a separate comma list (never "no"/"don't").
  veo: { maxChars: 1500, fps: 24, maxDurationS: 8, hasNegativeField: true, nativeAudio: true, defaultNegative: "" },
  // Higgsfield: preset owns the camera, ~3-5s social vertical; no negative field.
  higgsfield: { maxChars: 1200, fps: 24, maxDurationS: 5, hasNegativeField: false, nativeAudio: false, defaultNegative: "" },
};

function clamp(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max).replace(/[ ,.;:]+\w*$/, "").trim();
}

function negativeFor(spec: ShotPromptSpec, provider: VideoProvider): string | undefined {
  const profile = PROVIDER_PROFILES[provider];
  if (!profile.hasNegativeField) return undefined; // runway/seedance/higgsfield: never emit a negative field
  const fromSpec = (spec.negative ?? []).filter((n) => n && n.trim().length > 0).join(", ");
  const neg = fromSpec.length > 0 ? fromSpec : profile.defaultNegative;
  return neg.length > 0 ? neg : undefined;
}

// Render dialogue the way each native-audio model expects: quoted with a speaker, and "(no subtitles)" so the
// model does not burn text onto the frame (text rendering is unreliable everywhere).
function dialogueClause(spec: ShotPromptSpec): string {
  const lines = (spec.dialogue ?? []).filter((d) => d.line && d.line.trim().length > 0);
  if (lines.length === 0) return "";
  return lines.map((d) => `${d.speaker} says: "${d.line.trim()}" (no subtitles)`).join(" ");
}
function audioClause(spec: ShotPromptSpec): string {
  const parts: string[] = [];
  if (spec.sfx && spec.sfx.length > 0) parts.push(`SFX: ${spec.sfx.join(", ")}`);
  if (spec.ambient && spec.ambient.trim().length > 0) parts.push(`Ambient noise: ${spec.ambient.trim()}`);
  return parts.join(". ");
}

// Format a shot spec into one provider's best-practice prompt. This is the single place provider prompt
// idioms live; add a provider by adding a case + a profile.
export function formatPrompt(spec: ShotPromptSpec, provider: VideoProvider): FormattedPrompt {
  const profile = PROVIDER_PROFILES[provider];
  const aspect = spec.aspect ?? "9:16";
  const negativePrompt = negativeFor(spec, provider);
  const dlg = dialogueClause(spec);
  const audio = audioClause(spec);

  let prompt: string;
  switch (provider) {
    case "ltx": {
      // One flowing present-tense paragraph: shot, scene+lighting, subject+action, camera, dialogue, audio, style.
      const parts = [
        spec.shot,
        spec.scene ? `${spec.scene}${spec.lighting ? `, ${spec.lighting}` : ""}` : spec.lighting,
        [spec.subject, spec.action].filter(Boolean).join(" "),
        spec.camera,
        dlg,
        audio,
        spec.mood,
        spec.style,
      ].filter((p): p is string => !!p && p.trim().length > 0);
      prompt = parts.join(". ").replace(/\.\s*\./g, ".") + ".";
      break;
    }
    case "runway": {
      // "[camera movement] [shot]: [establishing scene + subject + action]. [style/details]." No negatives.
      const lead = [spec.camera, spec.shot].filter(Boolean).join(" ") || "static shot";
      const establishing = [spec.subject, spec.action, spec.scene].filter(Boolean).join(", ");
      const details = [spec.lighting, spec.mood, spec.style].filter(Boolean).join(", ");
      prompt = `${lead}: ${establishing}.${details ? ` ${details}.` : ""}`;
      break;
    }
    case "veo": {
      // [cinematography], [subject], [action], [context], [style & ambiance], then native-audio cues.
      const cine = [spec.shot, spec.camera].filter(Boolean).join(", ");
      const body = [cine, spec.subject, spec.action, spec.scene, [spec.lighting, spec.mood, spec.style].filter(Boolean).join(", ")]
        .filter((p) => p && p.trim().length > 0)
        .join(", ");
      prompt = [body, dlg, audio].filter((p) => p && p.trim().length > 0).join(". ");
      break;
    }
    case "seedance": {
      // Subject + action, scene, camera, lighting, style. Lock a static POV explicitly (Seedance defaults to cutting).
      const lockPov = spec.camera && /static|locked|no cut/i.test(spec.camera) ? "single continuous shot, no cuts" : "";
      const body = [[spec.subject, spec.action].filter(Boolean).join(" "), spec.scene, spec.camera, lockPov, spec.lighting, spec.style, dlg, audio]
        .filter((p) => p && p.trim().length > 0)
        .join(", ");
      prompt = body;
      break;
    }
    case "higgsfield": {
      // The preset owns the camera move; the prompt describes the subject + what happens during the move.
      const body = [[spec.subject, spec.action].filter(Boolean).join(" "), spec.scene, spec.lighting, spec.mood, spec.style, dlg]
        .filter((p) => p && p.trim().length > 0)
        .join(", ");
      prompt = body;
      break;
    }
  }

  return {
    provider,
    prompt: clamp(prompt, profile.maxChars),
    ...(negativePrompt ? { negativePrompt: clamp(negativePrompt, 400) } : {}),
    ...(provider === "higgsfield" && spec.preset ? { preset: spec.preset } : {}),
    aspect,
  };
}

// ---------- the documented do/dont rules per provider (served on /gallery, used in agent system prompts) ----------

export interface CraftRules {
  provider: VideoProvider;
  structure: string; // the recommended prompt formula
  dos: string[];
  donts: string[];
  audio: string;
  format: string; // duration / resolution / aspect facts
}

export const CRAFT_RULES: Record<VideoProvider, CraftRules> = {
  ltx: {
    provider: "ltx",
    structure: "One flowing present-tense paragraph, 4-8 sentences: establish the shot, set the scene + lighting, describe the subject and action, then the camera move, then audio. Put spoken dialogue in quotation marks.",
    dos: ["Write as a single paragraph in present tense", "Match detail to shot scale (close-ups need more)", "Describe camera movement relative to the subject", "Quote dialogue; name the language/accent"],
    donts: ["Internal emotional labels (sad/confused) instead of visual cues", "Readable on-screen text or logos", "Complex/chaotic physics", "Overloaded scenes with too many subjects"],
    audio: "Native joint audio. Quote dialogue; describe ambient and SFX explicitly. LipDub re-syncs animated mouths per language.",
    format: "Up to ~20s/call but stable to ~5-8s; keep shots <=7s and assemble. 24/25 fps. Vertical 9:16 supported.",
  },
  seedance: {
    provider: "seedance",
    structure: "Subject + Action + Scene + Camera language + Lighting + Style. For multiple cuts, label shots explicitly ('Shot 1:', 'Shot 2:'); keep the subject noun identical across beats.",
    dos: ["Use specific camera verbs (slow dolly in, rack focus, orbit)", "One primary action per shot", "Lock POV by stating what the camera is NOT doing", "Use first+last frame (end image) and reference packs for character lock"],
    donts: ["Quality-booster words alone (4K, beautiful)", "Comma-separated keyword/tag lists (image-gen style)", "Multiple competing actions in one shot", "Varying the subject description mid-prompt"],
    audio: "Native locked-sync audio (1.5/2.0): dialogue in quotes, ambient listed explicitly.",
    format: "4-15s, 720p, six aspect ratios including 9:16, ~24fps.",
  },
  veo: {
    provider: "veo",
    structure: "[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]. Direct it like a shot, not a description.",
    dos: ["Rich sensory detail (light, texture, atmosphere)", "Quote dialogue with a speaker; add '(no subtitles)' to suppress burned-in text", "Label 'SFX:' and 'Ambient noise:'", "Keep character descriptors identical across clips; use timestamp tags for multi-shot"],
    donts: ["Negative words in the positive prompt ('no', 'don't') - put unwanted items in the separate negative field as a comma list", "Vague/unstructured prompts", "Instruction-style commands"],
    audio: "Native audio always on, prompt-driven. Dialogue quoted + speaker; SFX/Ambient labeled.",
    format: "4/6/8s (8s for 1080p/4K), 720p default, 16:9 and 9:16, 24fps, SynthID watermark.",
  },
  runway: {
    provider: "runway",
    structure: "Text-to-video: '[camera movement]: [establishing scene]. [additional details].' Image-to-video: describe ONLY the motion, not the image.",
    dos: ["Simple, direct, positive descriptions", "Separate scene / subject / camera into sections", "Reinforce key ideas for adherence", "Translate concepts into concrete physical actions"],
    donts: ["Negative phrasing ('the camera doesn't move') - unsupported, may do the opposite", "Abstract/conceptual language", "Conversational language", "Re-describing the input image in image-to-video"],
    audio: "No native audio in Gen-3/Gen-4; mux dialogue/score separately.",
    format: "Gen-4 5/10s, 24fps, 720p (upscale to 4K), 16:9 / 9:16 / 1:1.",
  },
  higgsfield: {
    provider: "higgsfield",
    structure: "Preset + prompt: pick a named camera-motion preset (the preset owns the move) and write a short prompt for the subject + what happens during the move.",
    dos: ["One camera move per clip", "Describe the subject concretely", "Reference named cinematographers/directors for look", "Lock the keyframe before animating"],
    donts: ["Mixing camera + character + motion in one block", "Vague terms ('cinematic', 'dynamic') as motion", "Stacking multiple visual styles", "Overusing crash zoom"],
    audio: "Varies by backing model; treat audio as a separate mux.",
    format: "~3-5s, social vertical 9:16 (also 16:9, 1:1, 2.35:1). Resolution varies by backing model.",
  },
};

// ---------- Showrunner-derived narrative scaffolding (dramatic operators) ----------
// Showrunner injects "stylistic devices like reversals, foreshadowing, cliffhangers" as plot operators at the
// act and scene level. The Writer agent uses these to give a 90s episode a real beginning/middle/end.
export const DRAMATIC_OPERATORS: string[] = [
  "hook in the first 3 seconds",
  "raise the stakes mid-episode",
  "a reversal (an expectation overturned)",
  "foreshadow the ending early",
  "a cliffhanger on the final beat",
];
