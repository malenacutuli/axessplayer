// Promptcraft + gallery tests: each provider's formatter follows its documented house style, the look-correct
// negative is applied (and the photoreal "no cartoon" negative never fights an animated style), and the
// gallery's examples all carry provenance. No network. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrompt, PROVIDER_PROFILES, CRAFT_RULES, type ShotPromptSpec } from "../src/promptcraft.js";
import { GALLERY_STYLES, GALLERY_EXAMPLES, findStyle, galleryPayload } from "../src/promptGallery.js";

const spec: ShotPromptSpec = {
  subject: "a lone detective in a trench coat",
  action: "turns to face the camera as rain streaks the window",
  scene: "a neon-lit alley at night",
  shot: "medium close, low angle",
  camera: "slow push-in",
  lighting: "hard rim light",
  mood: "tense",
  style: "2D anime, cel-shaded",
  dialogue: [{ speaker: "the detective", line: "You shouldn't have come." }],
  sfx: ["distant thunder"],
  ambient: "steady rain",
  negative: ["blurry", "on-screen text"],
  aspect: "9:16",
};

test("LTX formats one flowing paragraph with a real negative field and quoted dialogue", () => {
  const f = formatPrompt(spec, "ltx");
  assert.equal(f.provider, "ltx");
  assert.ok(f.prompt.includes('"You shouldn\'t have come."'), "dialogue quoted");
  assert.ok(f.prompt.includes("(no subtitles)"), "suppresses burned-in text");
  assert.ok(/slow push-in/.test(f.prompt));
  assert.equal(f.negativePrompt, "blurry, on-screen text");
  assert.equal(f.aspect, "9:16");
  assert.ok(f.prompt.length <= PROVIDER_PROFILES.ltx.maxChars);
});

test("Runway uses the '[camera]: [scene]. [details].' formula and emits NO negative field", () => {
  const f = formatPrompt(spec, "runway");
  assert.ok(/^slow push-in medium close, low angle: /.test(f.prompt), `got: ${f.prompt}`);
  assert.equal(f.negativePrompt, undefined, "runway does not support negative phrasing");
  assert.ok(f.prompt.length <= 1000, "under Runway's 1000-char ceiling");
});

test("Veo emits native-audio cues (dialogue + SFX + ambient) and a separate negative list", () => {
  const f = formatPrompt(spec, "veo");
  assert.ok(f.prompt.includes("SFX: distant thunder"));
  assert.ok(f.prompt.includes("Ambient noise: steady rain"));
  assert.ok(f.prompt.includes('says: "You shouldn\'t have come."'));
  assert.equal(f.negativePrompt, "blurry, on-screen text");
});

test("Seedance locks a static POV explicitly and carries no negative field", () => {
  const f = formatPrompt({ ...spec, camera: "static shot" }, "seedance");
  assert.ok(/single continuous shot, no cuts/.test(f.prompt), "POV lock added for static camera");
  assert.equal(f.negativePrompt, undefined);
});

test("Higgsfield carries the preset and keeps the camera out of the text prompt", () => {
  const f = formatPrompt({ ...spec, preset: "Crash Zoom In" }, "higgsfield");
  assert.equal(f.preset, "Crash Zoom In");
  assert.ok(!/slow push-in/.test(f.prompt), "the preset owns the camera, not the prompt");
});

test("an animated style's negative never contains the photoreal 'cartoon/childish' booster", () => {
  for (const s of GALLERY_STYLES.filter((s) => s.animated)) {
    const neg = s.negative.join(" ").toLowerCase();
    assert.ok(!neg.includes("cartoon"), `${s.id} negative must not fight animation with 'cartoon'`);
    assert.ok(!neg.includes("childish"), `${s.id} negative must not include 'childish'`);
  }
  // and the photoreal default DOES carry it (so live action is steered away from game/cartoon looks)
  assert.ok(findStyle("photoreal-cinematic")!.negative.includes("cartoon"));
});

test("the style's negative flows through the formatter for a real-negative provider", () => {
  const anime = findStyle("anime-noir")!;
  const f = formatPrompt({ action: "x", style: anime.styleLine, negative: anime.negative }, "ltx");
  assert.ok(f.negativePrompt && f.negativePrompt.includes("photorealistic"));
  assert.ok(!f.negativePrompt!.includes("cartoon"));
});

test("every gallery style is well-formed and every example has a verbatim prompt + provenance URL", () => {
  assert.ok(GALLERY_STYLES.length >= 6);
  for (const s of GALLERY_STYLES) {
    assert.ok(s.id && s.label && s.styleLine && s.negative.length > 0, `style ${s.id} complete`);
    assert.equal(typeof s.animated, "boolean");
  }
  assert.ok(GALLERY_EXAMPLES.length >= 10);
  for (const e of GALLERY_EXAMPLES) {
    assert.ok(e.prompt.length > 20, `example "${e.title}" has a real prompt`);
    assert.match(e.source, /^https?:\/\//, `example "${e.title}" cites a source URL`);
    assert.ok(PROVIDER_PROFILES[e.provider], `example "${e.title}" names a known provider`);
  }
});

test("the gallery payload + craft rules cover all five providers", () => {
  const payload = galleryPayload();
  assert.ok(payload.styles.length === GALLERY_STYLES.length);
  for (const p of ["ltx", "seedance", "runway", "veo", "higgsfield"] as const) {
    assert.ok(CRAFT_RULES[p].structure.length > 0, `${p} has a documented structure rule`);
    assert.ok(CRAFT_RULES[p].dos.length > 0 && CRAFT_RULES[p].donts.length > 0);
  }
});
