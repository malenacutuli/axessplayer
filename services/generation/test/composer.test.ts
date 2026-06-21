// Scene composer tests: controlled-vocabulary composition into a provider-correct prompt, and the HARD LINE -
// an unconsented or unknown character is unselectable by construction. No network. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeScene, CompositionError, type SeriesWorld, type SceneSelection } from "../src/composer.js";
import type { ConsentGate } from "../src/consentGate.js";

// consent says yes only for the cleared character's ref.
const consent: ConsentGate = { async status(ref) { return { current: ref === "consent-mara" }; } };

const world: SeriesWorld = {
  seriesId: "series-1",
  locations: [{ id: "alley", label: "Rain Alley", description: "a neon-lit alley at night, rain streaking the windows" }],
  roster: {
    mara: { name: "mara", descriptor: "a fictional detective in a trench coat", refImageUrls: ["r1"], realLikeness: true, consentRef: "consent-mara" },
    real_actor: { name: "real_actor", descriptor: "a real person", refImageUrls: ["r2"], realLikeness: true, consentRef: "missing" },
  },
  props: [{ id: "umbrella", label: "a black umbrella" }],
  allowedActions: ["turns to face the camera", "walks away"],
  allowedBlocking: ["enters frame", "single"],
  defaultStyleId: "anime-noir",
};

const sel = (over: Partial<SceneSelection> = {}): SceneSelection => ({
  settingId: "alley",
  characterIds: ["mara"],
  action: "turns to face the camera",
  blocking: "single",
  propIds: ["umbrella"],
  styleId: "anime-noir",
  provider: "ltx",
  ...over,
});

test("composes a consented selection into a provider-correct prompt with the style-correct negative", async () => {
  const scene = await composeScene(sel(), world, { consent });
  assert.ok(scene.formatted.prompt.includes("cel-shaded"), "gallery style applied");
  assert.ok(scene.formatted.prompt.includes("black umbrella"), "prop folded into the action");
  assert.ok(scene.formatted.negativePrompt!.includes("photorealistic"), "animated style negative");
  assert.ok(!scene.formatted.negativePrompt!.includes("cartoon"), "never the photoreal negative on animation");
  assert.equal(scene.cast.length, 1);
  assert.equal(scene.variant.tags.composed, true);
  assert.deepEqual(scene.variant.tags.character_ids, ["mara"]);
});

test("HARD LINE: an unconsented real-likeness character is unselectable (CompositionError)", async () => {
  await assert.rejects(
    () => composeScene(sel({ characterIds: ["mara", "real_actor"] }), world, { consent }),
    (e: unknown) => e instanceof CompositionError && e.reasons.some((r) => r.includes("real_actor") && r.includes("consent")),
  );
});

test("rejects selections outside the controlled vocabulary", async () => {
  await assert.rejects(() => composeScene(sel({ action: "does a backflip off a building" }), world, { consent }), /action not in the series vocabulary/);
  await assert.rejects(() => composeScene(sel({ settingId: "moon" }), world, { consent }), /unknown setting/);
  await assert.rejects(() => composeScene(sel({ propIds: ["laser"] }), world, { consent }), /unknown prop/);
  await assert.rejects(() => composeScene(sel({ characterIds: [] }), world, { consent }), /at least one character/);
});

test("fills the variant axes (pov + intensity) so the scene is decision-engine ready", async () => {
  const scene = await composeScene(sel({ pov: "mara", intensity: 4 }), world, { consent });
  assert.equal(scene.variant.pov, "mara");
  assert.equal(scene.variant.intensity, 4);
  // intensity clamps to 1..5 with a server default of 3
  assert.equal((await composeScene(sel({ intensity: 99 }), world, { consent })).variant.intensity, 5);
  assert.equal((await composeScene(sel({ intensity: undefined }), world, { consent })).variant.intensity, 3);
});

test("an unknown character (no binding) is also blocked", async () => {
  await assert.rejects(() => composeScene(sel({ characterIds: ["ghost"] }), world, { consent }), /unknown character ghost/);
});
