// REELM showrunner-parity AGENTS. The production roles that turn a premise into a coherent episode, rebuilt
// as our own MODEL-AGNOSTIC structured-LLM calls (not autonomous loops, not a simulation). Each agent is a
// pure function over an injected LlmCaller with a strict parse + validate, so a model swaps by config and
// tests are deterministic with a scripted caller. State lives in the content graph, never in the agents.
//
// Roster mapped here (planning agents, cheap, no GPU):
//   1 Writer/Showrunner  -> makeLlmWritersRoom: premise -> BeatGraph (beats + variants + edges + canon facts)
//   2 Story Editor       -> reviewScript: runtime budget + scene/shot completeness check (canon is validateBeatGraph)
//   3 Casting/Character  -> resolveCast: bind characters to refs/LoRAs/voice, BLOCK real-likeness without consent
//   4 Cinematographer    -> planShots: a scene -> ShotPlan[] (camera, 9:16, <=7s, motion, continues_from_prev)
//   5 Dialogue/Voice     -> planDialogue: per-shot lines -> a TTS plan (voice id, language, emotion)
//
// Agent 6 (Renderer) is the router + LTX provider (router.ts/providerClient.ts); 7 (Continuity QA) is
// consistency.ts; 8 (Editor) is the stitch client; 9 (Localizer) is services/ingestion. No em dashes.

import type { EdgeConfig } from "./providerClient.js";
import { validateBeatGraph, type BeatGraph, type BeatSpec, type EdgeSpec, type VariantSpec, type WritersRoom } from "./showrunner.js";
import type { ConsentGate } from "./consentGate.js";
import { formatPrompt, type FormattedPrompt, type ShotPromptSpec, type VideoProvider } from "./promptcraft.js";
import { findStyle, type GalleryStyle } from "./promptGallery.js";

// ---------- the model-agnostic LLM port ----------
// One method: complete a prompt to text. The real impl wraps the google-gemini edge fn (same as the scene
// expander); a scripted fake drives tests. Swapping Claude/GPT/local is a config change behind this port.
export interface LlmCaller {
  complete(prompt: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

// Real caller over the google-gemini edge function. Robust: returns "" on any failure so each agent falls
// back to its deterministic default rather than throwing.
export function makeEdgeLlm(cfg: EdgeConfig, fetchFn: typeof fetch = fetch): LlmCaller {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, apikey: cfg.apiKey, "content-type": "application/json" };
  return {
    async complete(prompt, opts): Promise<string> {
      try {
        const res = await fetchFn(`${cfg.supabaseUrl}/functions/v1/google-gemini`, {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt, model: "gemini-2.5-flash", temperature: opts?.temperature ?? 0.7, maxTokens: opts?.maxTokens ?? 1600 }),
        });
        if (!res.ok) return "";
        const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; text?: string; response?: string };
        return String(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? j?.text ?? j?.response ?? "");
      } catch {
        return "";
      }
    },
  };
}

// Pull the first balanced JSON value (object or array) out of an LLM response, tolerating prose or ```json
// fences around it. Returns null when nothing parses.
export function extractJson(text: string): unknown {
  if (!text) return null;
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function rec(v: unknown): Record<string, string> {
  if (v == null || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
  }
  return out;
}

// ---------- Agent 1: Writer / Showrunner (premise -> BeatGraph) ----------

// A real WritersRoom (the showrunner.ts port). Prompts the LLM for a structured beat graph, parses + coerces
// it, and validates with the canon constraint check; on any failure it returns a minimal valid linear graph
// so the pipeline always has something registrable rather than throwing.
export function makeLlmWritersRoom(llm: LlmCaller, opts: { beats?: number } = {}): WritersRoom {
  const beats = Math.max(3, Math.min(10, opts.beats ?? 6));
  return {
    async expand(premise: string): Promise<BeatGraph> {
      const ask =
        `You are the writers room for a short vertical drama. Expand the premise into a beat graph of exactly ` +
        `${beats} beats that sum to one ~90 second episode. Hook in the first beat, a cliffhanger in the last. ` +
        `Return ONLY JSON, no prose, in this exact shape:\n` +
        `{"beats":[{"id":"b1","role":"setup","canonFacts":{"location":"..."},` +
        `"variants":[{"id":"b1-pace-fast","axis":"pace","value":"fast"}]}],` +
        `"edges":[{"from":"b1","to":"b2","condition":{}}]}\n` +
        `Every beat needs at least one variant on a controllable axis (pace|tone|cliffhanger). Edges link real ` +
        `beat ids in order. Do not contradict an earlier beat's canonFacts in a later one. Premise: ${premise}`;
      try {
        const text = await llm.complete(ask, { temperature: 0.7, maxTokens: 1800 });
        const graph = parseBeatGraph(premise, text);
        if (graph && validateBeatGraph(graph).ok) return graph;
      } catch {
        // fall through to the deterministic fallback
      }
      return fallbackLinearGraph(premise, beats);
    },
  };
}

// Coerce an LLM JSON blob into a BeatGraph. Tolerant of missing pieces (synthesizes ids, a default variant,
// and linear edges when omitted) but never invents a contradiction. Returns null when there are no usable beats.
export function parseBeatGraph(premise: string, text: string): BeatGraph | null {
  const root = extractJson(text);
  if (root == null || typeof root !== "object") return null;
  const r = root as Record<string, unknown>;
  const rawBeats = Array.isArray(r.beats) ? r.beats : Array.isArray(root) ? (root as unknown[]) : [];
  if (rawBeats.length === 0) return null;

  const beats: BeatSpec[] = rawBeats.map((b, i) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const id = str(o.id, `b${i + 1}`);
    const role = str(o.role, i === 0 ? "setup" : i === rawBeats.length - 1 ? "ending" : "beat");
    const canonFacts = rec(o.canonFacts ?? o.canon_facts);
    const rawVariants = Array.isArray(o.variants) ? o.variants : [];
    const variants: VariantSpec[] = rawVariants.map((v, j) => {
      const vo = (v ?? {}) as Record<string, unknown>;
      const axis = str(vo.axis, "pace");
      const value = str(vo.value, "default");
      return { id: str(vo.id, `${id}-${axis}-${j + 1}`), axis, value };
    });
    if (variants.length === 0) variants.push({ id: `${id}-pace-default`, axis: "pace", value: "default" });
    return { id, role, canonFacts, variants };
  });

  const ids = new Set(beats.map((b) => b.id));
  let edges: EdgeSpec[] = (Array.isArray(r.edges) ? r.edges : [])
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { from: str(o.from), to: str(o.to), condition: (o.condition ?? {}) as Record<string, unknown> };
    })
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  // No usable edges from the model: lay down a linear spine so the graph is connected and canon-checkable.
  if (edges.length === 0 && beats.length >= 2) {
    edges = beats.slice(0, -1).map((b, i) => ({ from: b.id, to: beats[i + 1].id, condition: {} }));
  }
  return { premise, beats, edges };
}

// A minimal valid linear graph of `beats` beats (3..10): every beat has a variant, edges link real beats in
// order, no contradiction. The first beat is the setup, the last the ending, the middle beats rise.
export function fallbackLinearGraph(premise: string, beats = 3): BeatGraph {
  const n = Math.max(3, Math.min(10, beats));
  const roleFor = (i: number): string => (i === 0 ? "setup" : i === n - 1 ? "ending" : "rising");
  const list: BeatSpec[] = Array.from({ length: n }, (_, i) => {
    const id = `b${i + 1}`;
    return { id, role: roleFor(i), canonFacts: {}, variants: [{ id: `${id}-pace-default`, axis: "pace", value: "default" }] };
  });
  const edges: EdgeSpec[] = list.slice(0, -1).map((b, i) => ({ from: b.id, to: list[i + 1].id, condition: {} }));
  return { premise, beats: list, edges };
}

// ---------- Agent 4: Cinematographer / Director (scene -> ShotPlan[]) ----------

export interface SceneInput {
  id: string;
  summary: string;
  mood?: string;
  characters?: string[];
}

export interface ShotPlan {
  idx: number;
  sceneId: string;
  durationS: number; // <= maxShotS, kept inside the renderer's stable window
  aspect: string; // "9:16"
  shot: string; // framing, e.g. "medium close, low angle"
  camera: string; // movement, e.g. "slow push-in"
  action: string; // the core action, present tense
  mood: string;
  characters: string[];
  continuesFromPrev: boolean; // chain this shot on the previous shot's last frame (within a scene)
  // The best-practice prompt for the chosen renderer, set by formatShot (a gallery style + the provider's
  // house idiom). Present once a script is built with a provider/style; the renderer sends this verbatim.
  prompt?: string;
  negativePrompt?: string;
  preset?: string; // Higgsfield preset, when that provider is targeted
}

export interface PlanShotsOptions {
  targetS: number; // seconds to allocate to this scene
  maxShotS?: number; // hard per-shot ceiling (LTX stable window), default 7
}

// Decompose one scene into chained shots that sum to ~targetS, each <= maxShotS. Prompts the LLM for a shot
// list and clamps/normalizes it; on any failure splits targetS into evenly sized shots so a scene always
// yields a plan. The first shot of a scene is a fresh start; the rest continue from the previous frame.
export async function planShots(llm: LlmCaller, scene: SceneInput, opts: PlanShotsOptions): Promise<ShotPlan[]> {
  const maxShotS = Math.max(2, Math.min(7, opts.maxShotS ?? 7));
  const targetS = Math.max(maxShotS, Math.round(opts.targetS));
  const ask =
    `You are the cinematographer for a 9:16 vertical animated episode. Break this scene into consecutive ` +
    `shots that sum to about ${targetS} seconds, each at most ${maxShotS} seconds. Favor single-subject close ` +
    `and medium shots. Return ONLY a JSON array, each item: ` +
    `{"durationS":5,"shot":"medium close, low angle","camera":"slow push-in","action":"present-tense action",` +
    `"mood":"tense","characters":["mara"]}. Scene: ${scene.summary}` +
    (scene.mood ? ` Mood: ${scene.mood}.` : "") +
    (scene.characters && scene.characters.length > 0 ? ` Characters: ${scene.characters.join(", ")}.` : "");

  let raw: unknown = null;
  try {
    raw = extractJson(await llm.complete(ask, { temperature: 0.6, maxTokens: 1200 }));
  } catch {
    raw = null;
  }
  const items = Array.isArray(raw) ? raw : [];
  let plans: ShotPlan[] = items.map((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const d = typeof o.durationS === "number" ? o.durationS : typeof o.duration === "number" ? (o.duration as number) : maxShotS;
    return {
      idx: i,
      sceneId: scene.id,
      durationS: Math.max(2, Math.min(maxShotS, Math.round(d))),
      aspect: "9:16",
      shot: str(o.shot, "medium shot"),
      camera: str(o.camera, "static"),
      action: str(o.action, scene.summary).slice(0, 600),
      mood: str(o.mood, scene.mood ?? "neutral"),
      characters: Array.isArray(o.characters) ? (o.characters as unknown[]).filter((c): c is string => typeof c === "string") : scene.characters ?? [],
      continuesFromPrev: i > 0,
    };
  });

  if (plans.length === 0) plans = evenShots(scene, targetS, maxShotS);
  return plans.map((p, i) => ({ ...p, idx: i, continuesFromPrev: i > 0 }));
}

// Deterministic fallback: split targetS into ceil(targetS/maxShotS) evenly sized shots of the scene.
function evenShots(scene: SceneInput, targetS: number, maxShotS: number): ShotPlan[] {
  const n = Math.max(1, Math.ceil(targetS / maxShotS));
  const each = Math.max(2, Math.min(maxShotS, Math.round(targetS / n)));
  return Array.from({ length: n }, (_, i) => ({
    idx: i,
    sceneId: scene.id,
    durationS: each,
    aspect: "9:16",
    shot: "medium shot",
    camera: i === 0 ? "static" : "slow push-in",
    action: scene.summary.slice(0, 600),
    mood: scene.mood ?? "neutral",
    characters: scene.characters ?? [],
    continuesFromPrev: i > 0,
  }));
}

// Build the provider-agnostic prompt spec for a shot, applying a gallery style (its style line, look-correct
// negative, and camera bias when the shot camera is generic).
export function shotPromptSpec(shot: ShotPlan, style?: GalleryStyle): ShotPromptSpec {
  const cameraGeneric = !shot.camera || /^static$/i.test(shot.camera);
  return {
    action: shot.action,
    subject: shot.characters.length > 0 ? shot.characters.join(", ") : undefined,
    shot: shot.shot,
    camera: cameraGeneric && style?.cameraBias ? style.cameraBias : shot.camera,
    mood: shot.mood,
    style: style?.styleLine,
    negative: style?.negative,
    aspect: shot.aspect,
  };
}

// Format one shot into the chosen renderer's best-practice prompt (LTX by default), applying a gallery style.
export function formatShot(shot: ShotPlan, opts: { provider?: VideoProvider; style?: GalleryStyle } = {}): FormattedPrompt {
  return formatPrompt(shotPromptSpec(shot, opts.style), opts.provider ?? "ltx");
}

// ---------- Agent 5: Dialogue / Voice (shots -> TTS plan) ----------

export interface ShotLine {
  character: string;
  line: string;
}
export interface VoicePlan {
  shotIdx: number;
  character: string;
  line: string;
  voiceId: string | null; // resolved from the cast binding; null = use the renderer's native voice
  lang: string;
  emotion: string;
}

// Build the TTS plan from shots that carry dialogue. PURE (no LLM): the lines already exist on the shot plan;
// this resolves the voice id from the cast bindings and carries language + an emotion derived from the shot
// mood. Hero dialogue routes to ElevenLabs (voiceId set); ambient-only shots produce no voice plan.
export function planDialogue(
  shots: ReadonlyArray<ShotPlan & { dialogue?: ShotLine[] }>,
  cast: Record<string, { voiceId?: string }>,
  opts: { lang?: string } = {},
): VoicePlan[] {
  const lang = opts.lang ?? "en";
  const out: VoicePlan[] = [];
  for (const shot of shots) {
    for (const line of shot.dialogue ?? []) {
      if (!line.line) continue;
      out.push({
        shotIdx: shot.idx,
        character: line.character,
        line: line.line,
        voiceId: cast[line.character]?.voiceId ?? null,
        lang,
        emotion: shot.mood || "neutral",
      });
    }
  }
  return out;
}

// ---------- Agent 2: Story Editor (runtime budget + completeness review) ----------

export interface ScriptReview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  runtimeS: number; // sum of shot durations
}

// Review a shot plan against the runtime budget and basic completeness: at least one shot, every shot has an
// action and a duration inside the stable window, and the total runtime lands within tolerance of the target.
// Errors block; warnings inform. (Canon continuity is validateBeatGraph in showrunner.ts.)
export function reviewScript(shots: readonly ShotPlan[], opts: { targetS: number; toleranceS?: number; maxShotS?: number }): ScriptReview {
  const tolerance = opts.toleranceS ?? Math.max(10, Math.round(opts.targetS * 0.25));
  const maxShotS = opts.maxShotS ?? 7;
  const errors: string[] = [];
  const warnings: string[] = [];
  let runtimeS = 0;
  if (shots.length === 0) errors.push("no shots");
  for (const s of shots) {
    runtimeS += s.durationS;
    if (s.durationS <= 0) errors.push(`shot ${s.idx} has non-positive duration`);
    if (s.durationS > maxShotS) warnings.push(`shot ${s.idx} duration ${s.durationS}s exceeds the ${maxShotS}s stable window`);
    if (!s.action || s.action.trim().length === 0) errors.push(`shot ${s.idx} has no action`);
  }
  if (shots.length > 0 && Math.abs(runtimeS - opts.targetS) > tolerance) {
    warnings.push(`runtime ${runtimeS}s is more than ${tolerance}s off the ${opts.targetS}s target`);
  }
  return { ok: errors.length === 0, errors, warnings, runtimeS };
}

// ---------- Agent 3: Casting / Character (bindings + the rights gate) ----------

export interface CharacterBinding {
  name: string;
  descriptor: string; // the fixed 50-80 word descriptor block, identical every shot
  refImageUrls: string[];
  styleLora?: string;
  characterLora?: string;
  voiceId?: string;
  realLikeness?: boolean; // a real person's likeness: requires a current consent record
  consentRef?: string;
}

export interface CastResult {
  bound: CharacterBinding[];
  blocked: Array<{ name: string; reason: string }>;
}

// Resolve each requested character to its binding. HARD RIGHTS GATE: a real-likeness character with no current
// consent-ledger entry is BLOCKED before any generation spend (fail closed), matching the consent gate the
// renderer enforces. A character with no binding at all is blocked as unresolved.
export async function resolveCast(
  characters: readonly string[],
  bindings: Record<string, CharacterBinding>,
  consent: ConsentGate,
): Promise<CastResult> {
  const bound: CharacterBinding[] = [];
  const blocked: Array<{ name: string; reason: string }> = [];
  for (const name of characters) {
    const b = bindings[name];
    if (!b) {
      blocked.push({ name, reason: "no_binding" });
      continue;
    }
    if (b.realLikeness) {
      const state = await consent.status(b.consentRef);
      if (!state.current) {
        blocked.push({ name, reason: "consent_required" });
        continue;
      }
    }
    bound.push(b);
  }
  return { bound, blocked };
}

// ---------- the assembled script (Writer -> Cinematographer -> Story Editor) ----------

export interface EpisodeScript {
  premise: string;
  graph: BeatGraph;
  graphValid: { ok: boolean; errors: string[] };
  shots: ShotPlan[]; // each carries a best-practice prompt for `provider`, styled by `styleId`
  review: ScriptReview;
  provider: VideoProvider;
  styleId?: string;
}

// Run the planning agents in sequence: expand the premise to a beat graph (Writer), validate canon, plan shots
// per beat to fill the runtime (Cinematographer), review the runtime budget (Story Editor), then format every
// shot into the chosen renderer's best-practice prompt with the chosen gallery style. No GPU spend: this is
// the cheap upfront planning the renderer consumes.
export async function buildEpisodeScript(
  premise: string,
  deps: { room: WritersRoom; llm: LlmCaller },
  opts: { targetS?: number; maxShotS?: number; provider?: VideoProvider; styleId?: string } = {},
): Promise<EpisodeScript> {
  const targetS = opts.targetS ?? 90;
  const maxShotS = opts.maxShotS ?? 7;
  const provider = opts.provider ?? "ltx";
  const style = opts.styleId ? findStyle(opts.styleId) : undefined;
  const graph = await deps.room.expand(premise);
  const graphValid = validateBeatGraph(graph);
  const perBeatS = Math.max(maxShotS, Math.round(targetS / Math.max(1, graph.beats.length)));
  const shots: ShotPlan[] = [];
  for (const beat of graph.beats) {
    const scene: SceneInput = { id: beat.id, summary: `${beat.role}: ${premise}`, characters: [] };
    const beatShots = await planShots(deps.llm, scene, { targetS: perBeatS, maxShotS });
    for (const s of beatShots) {
      const shot: ShotPlan = { ...s, idx: shots.length };
      const f = formatShot(shot, { provider, style });
      shot.prompt = f.prompt;
      if (f.negativePrompt) shot.negativePrompt = f.negativePrompt;
      if (f.preset) shot.preset = f.preset;
      shots.push(shot);
    }
  }
  const review = reviewScript(shots, { targetS, maxShotS });
  return { premise, graph, graphValid, shots, review, provider, styleId: opts.styleId };
}
