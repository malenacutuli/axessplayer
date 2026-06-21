// REELM showrunner-parity agent tests: the Writer (premise -> beat graph), Cinematographer (scene -> shots),
// Dialogue (shots -> TTS plan), Story Editor (runtime review), and Casting (rights gate). A scripted LlmCaller
// makes every agent deterministic; failures fall back to valid defaults. No network, no GPU. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJson,
  parseBeatGraph,
  fallbackLinearGraph,
  makeLlmWritersRoom,
  planShots,
  planDialogue,
  reviewScript,
  resolveCast,
  buildEpisodeScript,
  type LlmCaller,
  type ShotPlan,
  type CharacterBinding,
} from "../src/agents.js";
import { validateBeatGraph } from "../src/showrunner.js";
import type { ConsentGate } from "../src/consentGate.js";

// A scripted caller: returns the next canned response per call, repeating the last.
function scripted(responses: string[]): LlmCaller {
  let i = 0;
  return {
    async complete(): Promise<string> {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r ?? "";
    },
  };
}
const silent: LlmCaller = { async complete() { return ""; } };

test("extractJson pulls a JSON object out of prose and code fences", () => {
  assert.deepEqual(extractJson('here you go: ```json\n{"a":1}\n``` done'), { a: 1 });
  assert.deepEqual(extractJson("prefix [1,2,3] suffix"), [1, 2, 3]);
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson('{"broken": '), null);
});

test("parseBeatGraph coerces a model graph and synthesizes a linear spine when edges are missing", () => {
  const text = '{"beats":[{"id":"b1","role":"setup","canonFacts":{"loc":"alley"},"variants":[{"id":"v1","axis":"pace","value":"fast"}]},{"id":"b2","role":"ending","canonFacts":{},"variants":[]}]}';
  const g = parseBeatGraph("p", text)!;
  assert.ok(g);
  assert.equal(g.beats.length, 2);
  assert.equal(g.beats[1].variants.length, 1, "a beat with no variants gets a default one");
  assert.equal(g.edges.length, 1, "linear spine synthesized b1->b2");
  assert.ok(validateBeatGraph(g).ok);
});

test("parseBeatGraph returns null when there are no beats", () => {
  assert.equal(parseBeatGraph("p", '{"beats":[]}'), null);
  assert.equal(parseBeatGraph("p", "garbage"), null);
});

test("fallbackLinearGraph is always a valid registrable graph", () => {
  const g = fallbackLinearGraph("premise", 5);
  assert.equal(g.beats.length, 5);
  assert.ok(g.beats.every((b) => b.variants.length >= 1));
  assert.equal(g.edges.length, 4);
  assert.ok(validateBeatGraph(g).ok);
});

test("WritersRoom expands a premise to a valid graph from the model output", async () => {
  const room = makeLlmWritersRoom(
    scripted(['{"beats":[{"id":"b1","role":"setup","canonFacts":{},"variants":[{"id":"v1","axis":"tone","value":"dark"}]},{"id":"b2","role":"climax","canonFacts":{},"variants":[{"id":"v2","axis":"pace","value":"fast"}]},{"id":"b3","role":"ending","canonFacts":{},"variants":[{"id":"v3","axis":"cliffhanger","value":"yes"}]}],"edges":[{"from":"b1","to":"b2","condition":{}},{"from":"b2","to":"b3","condition":{}}]}']),
  );
  const g = await room.expand("a detective in the rain");
  assert.equal(g.premise, "a detective in the rain");
  assert.equal(g.beats.length, 3);
  assert.ok(validateBeatGraph(g).ok);
});

test("WritersRoom falls back to a valid linear graph when the model returns garbage", async () => {
  const room = makeLlmWritersRoom(silent, { beats: 4 });
  const g = await room.expand("premise");
  assert.ok(validateBeatGraph(g).ok);
  assert.equal(g.beats.length, 4);
});

test("Cinematographer plans chained shots inside the stable window from the model output", async () => {
  const llm = scripted(['[{"durationS":5,"shot":"close","camera":"push-in","action":"she turns","mood":"tense","characters":["mara"]},{"durationS":12,"shot":"wide","camera":"static","action":"rain falls","mood":"calm","characters":[]}]']);
  const shots = await planShots(llm, { id: "s1", summary: "the confrontation", characters: ["mara"] }, { targetS: 12, maxShotS: 7 });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].idx, 0);
  assert.equal(shots[0].continuesFromPrev, false, "first shot is a fresh start");
  assert.equal(shots[1].continuesFromPrev, true, "later shots chain");
  assert.ok(shots.every((s) => s.durationS <= 7), "12s clamped into the 7s window");
  assert.equal(shots[0].aspect, "9:16");
});

test("Cinematographer falls back to evenly split shots when the model gives nothing", async () => {
  const shots = await planShots(silent, { id: "s1", summary: "a quiet street" }, { targetS: 18, maxShotS: 6 });
  assert.ok(shots.length >= 3, "18s / 6s => at least 3 shots");
  assert.ok(shots.every((s) => s.durationS <= 6 && s.durationS >= 2));
  assert.equal(shots[0].sceneId, "s1");
});

test("Dialogue plan resolves voice ids from the cast and carries mood as emotion", () => {
  const shots: Array<ShotPlan & { dialogue?: { character: string; line: string }[] }> = [
    { idx: 0, sceneId: "s1", durationS: 5, aspect: "9:16", shot: "close", camera: "static", action: "x", mood: "angry", characters: ["mara"], continuesFromPrev: false, dialogue: [{ character: "mara", line: "You shouldn't have come." }] },
    { idx: 1, sceneId: "s1", durationS: 5, aspect: "9:16", shot: "wide", camera: "static", action: "y", mood: "calm", characters: [], continuesFromPrev: true },
  ];
  const plan = planDialogue(shots, { mara: { voiceId: "voice_mara" } }, { lang: "en" });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].voiceId, "voice_mara");
  assert.equal(plan[0].emotion, "angry");
  assert.equal(plan[0].lang, "en");
});

test("Story Editor flags an empty plan and warns on a runtime far off target", () => {
  assert.equal(reviewScript([], { targetS: 90 }).ok, false);
  const shots: ShotPlan[] = Array.from({ length: 2 }, (_, i) => ({ idx: i, sceneId: "s", durationS: 5, aspect: "9:16", shot: "x", camera: "y", action: "does a thing", mood: "n", characters: [], continuesFromPrev: i > 0 }));
  const r = reviewScript(shots, { targetS: 90, toleranceS: 15 });
  assert.ok(r.ok, "no hard errors");
  assert.equal(r.runtimeS, 10);
  assert.ok(r.warnings.some((w) => w.includes("off the 90s target")));
});

test("Story Editor errors when a shot has no action", () => {
  const shots: ShotPlan[] = [{ idx: 0, sceneId: "s", durationS: 5, aspect: "9:16", shot: "x", camera: "y", action: "", mood: "n", characters: [], continuesFromPrev: false }];
  const r = reviewScript(shots, { targetS: 5 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("no action")));
});

// Casting: a consent gate that says yes only for a known ref.
const consent: ConsentGate = { async status(ref) { return { current: ref === "consent-ok" }; } };

test("Casting binds resolvable characters and BLOCKS real-likeness without current consent", async () => {
  const bindings: Record<string, CharacterBinding> = {
    mara: { name: "mara", descriptor: "a fictional detective", refImageUrls: ["r1"] },
    real_actor: { name: "real_actor", descriptor: "a real person", refImageUrls: ["r2"], realLikeness: true, consentRef: "missing" },
    cleared_actor: { name: "cleared_actor", descriptor: "a cleared person", refImageUrls: ["r3"], realLikeness: true, consentRef: "consent-ok" },
  };
  const res = await resolveCast(["mara", "real_actor", "cleared_actor", "ghost"], bindings, consent);
  const boundNames = res.bound.map((b) => b.name).sort();
  assert.deepEqual(boundNames, ["cleared_actor", "mara"]);
  assert.deepEqual(res.blocked.find((b) => b.name === "real_actor")?.reason, "consent_required");
  assert.deepEqual(res.blocked.find((b) => b.name === "ghost")?.reason, "no_binding");
});

test("buildEpisodeScript runs Writer -> Cinematographer -> Story Editor into one script (no GPU)", async () => {
  const room = makeLlmWritersRoom(silent, { beats: 6 }); // falls back to a valid 6-beat graph
  const script = await buildEpisodeScript("a heist gone wrong", { room, llm: silent }, { targetS: 90, maxShotS: 7 });
  assert.equal(script.graph.beats.length, 6);
  assert.ok(script.graphValid.ok);
  assert.ok(script.shots.length >= 6, "at least one shot per beat");
  assert.ok(script.shots.every((s, i) => s.idx === i), "shots are re-indexed contiguously");
  assert.ok(script.review.runtimeS > 0);
});
