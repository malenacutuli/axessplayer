// Prompt 26 router tests: decision-tree routing, provider config-swap, and sync/poll/webhook normalization
// into one output format with sub-generation caching. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseModel,
  runModel,
  estimateModelCostUsd,
  defaultRegistry,
  FakeProviderClient,
  InMemorySubGenerationCache,
  NoRouteError,
  type ModelRegistry,
  type GenerationBrief,
} from "../src/router.js";

const REG: ModelRegistry = [
  { id: "cheap-preview", provider: "fal", model_id: "ltx-preview", modality: "video", invocation: "poll", capabilities: ["first_last_frame"], costPerSecondUsd: 0.01, costPerCallUsd: 0, maxDurationS: 15, renderTier: "preview" },
  { id: "runway-multishot", provider: "runway", model_id: "gen4-multi", modality: "video", invocation: "poll", capabilities: ["multi_shot"], costPerSecondUsd: 0.12, costPerCallUsd: 0, maxDurationS: 15, renderTier: "final" },
  { id: "fal-physics", provider: "fal", model_id: "kling-physics", modality: "video", invocation: "poll", capabilities: ["physics"], costPerSecondUsd: 0.2, costPerCallUsd: 0, maxDurationS: 10, renderTier: "final" },
  { id: "fal-basic-final", provider: "fal", model_id: "fal-basic", modality: "video", invocation: "sync", capabilities: [], costPerSecondUsd: 0.05, costPerCallUsd: 0, maxDurationS: 15, renderTier: "final" },
];

test("preview brief routes to the cheapest preview-capable model", () => {
  const brief: GenerationBrief = { modality: "video", durationS: 5, preview: true };
  const d = chooseModel(brief, REG);
  assert.equal(d.model.id, "cheap-preview");
  assert.match(d.reason, /preview/);
});

test("a multi-cut shot routes to a multi-shot model even when pricier", () => {
  const brief: GenerationBrief = { modality: "video", durationS: 5, shotCount: 4 };
  const d = chooseModel(brief, REG);
  assert.equal(d.model.id, "runway-multishot");
  assert.match(d.reason, /multi_shot/);
});

test("a heavy-physics need hard-filters to a physics model", () => {
  const brief: GenerationBrief = { modality: "video", durationS: 8, needs: ["physics"] };
  const d = chooseModel(brief, REG);
  assert.equal(d.model.id, "fal-physics");
});

test("a single-cut final with no special needs takes the cheapest final", () => {
  const brief: GenerationBrief = { modality: "video", durationS: 5 };
  const d = chooseModel(brief, REG);
  assert.equal(d.model.id, "fal-basic-final"); // 0.05/s beats runway 0.12/s and physics 0.2/s
});

test("CONFIG SWAP: the same brief runs on two providers via providerHint, one output shape", async () => {
  const brief: GenerationBrief = { modality: "video", durationS: 5, shotCount: 4 };
  const client = new FakeProviderClient(2);

  const runwayPick = chooseModel({ ...brief, providerHint: "runway" }, REG);
  const falPick = chooseModel({ ...brief, providerHint: "fal" }, REG);
  assert.equal(runwayPick.model.provider, "runway");
  assert.equal(falPick.model.provider, "fal");

  const a = await runModel({ model: runwayPick.model, params: { prompt: "x", durationS: 5 } }, { client });
  const b = await runModel({ model: falPick.model, params: { prompt: "x", durationS: 5 } }, { client });

  // One normalized output shape regardless of provider.
  for (const out of [a, b]) {
    assert.equal(typeof out.outputUrl, "string");
    assert.equal(typeof out.provider, "string");
    assert.equal(typeof out.modelHandle, "string");
    assert.ok("contentHash" in out && "durationS" in out && "invocation" in out);
  }
  assert.notEqual(a.provider, b.provider);
});

test("runModel normalizes a sync model (finishes on submit)", async () => {
  const sync = REG.find((m) => m.invocation === "sync")!;
  const out = await runModel({ model: sync, params: { p: 1 } }, { client: new FakeProviderClient(3) });
  assert.equal(out.cached, false);
  assert.ok(out.outputUrl.includes(sync.provider));
});

test("runModel normalizes a poll model (pending then done) and bounds the poll loop", async () => {
  const poll = REG.find((m) => m.invocation === "poll")!;
  const out = await runModel({ model: poll, params: { p: 1 } }, { client: new FakeProviderClient(3) });
  assert.equal(out.cached, false);

  await assert.rejects(
    runModel({ model: poll, params: { p: 2 } }, { client: new FakeProviderClient(10), maxPolls: 2 }),
    /did not finish/,
  );
});

test("identical sub-generations are cached (a retry never pays twice)", async () => {
  const cache = new InMemorySubGenerationCache();
  const poll = REG.find((m) => m.id === "runway-multishot")!;
  const first = await runModel({ model: poll, params: { prompt: "same" } }, { client: new FakeProviderClient(2), cache });
  const second = await runModel({ model: poll, params: { prompt: "same" } }, { client: new FakeProviderClient(2), cache });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.outputUrl, second.outputUrl);
});

test("no matching model throws NoRouteError", () => {
  assert.throws(() => chooseModel({ modality: "video", durationS: 999 }, REG), NoRouteError);
  assert.throws(() => chooseModel({ modality: "lipsync", durationS: 5 }, REG), NoRouteError);
});

test("estimateModelCostUsd accounts for per-call and per-second", () => {
  const m = REG.find((x) => x.id === "cheap-preview")!;
  assert.equal(estimateModelCostUsd(m, 10), 0.1);
});

test("the default registry covers all four modalities", () => {
  const reg = defaultRegistry();
  for (const modality of ["video", "image", "voice", "lipsync"] as const) {
    assert.ok(reg.some((m) => m.modality === modality), `missing ${modality}`);
  }
});
