// Prompt 26 consistency QA + auto-retry tests: scoring, reject/regenerate, pass/fail logging, cost-gate
// pause across retries, provider switch, first-last-frame chaining, and the consent gate. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  evaluateShot,
  passRate,
  produceConsistentShot,
  chainSegments,
  ScriptedScorer,
  DEFAULT_THRESHOLDS,
  type ShotScore,
} from "../src/consistency.js";
import { FakeProviderClient, type ModelRegistry, type GenerationBrief } from "../src/router.js";
import {
  guardLikenessConsent,
  InMemoryConsentGate,
  ConsentBlockedError,
  tierNeedsConsent,
} from "../src/consentGate.js";

const REG: ModelRegistry = [
  { id: "prov-a", provider: "providerA", model_id: "a", modality: "video", invocation: "poll", capabilities: [], costPerSecondUsd: 0.1, costPerCallUsd: 0, maxDurationS: 15, renderTier: "final" },
  { id: "prov-b", provider: "providerB", model_id: "b", modality: "video", invocation: "poll", capabilities: [], costPerSecondUsd: 0.1, costPerCallUsd: 0, maxDurationS: 15, renderTier: "final" },
];

const BRIEF: GenerationBrief = { modality: "video", durationS: 5 };
const REFS = { face: [1, 0, 0, 0], scene: [0, 1, 0, 0] };

function shared(overrides: Partial<Parameters<typeof produceConsistentShot>[0]> = {}) {
  return {
    registry: REG,
    client: new FakeProviderClient(1),
    budget: { capUsd: 100, spentUsd: 0 },
    refs: REFS,
    ...overrides,
  };
}

test("cosineSimilarity: identical vectors = 1, orthogonal = 0, bad input = null", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], [1]), null);
  assert.equal(cosineSimilarity([1, 2], [1]), null);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), null);
});

test("evaluateShot: passes above threshold, rejects below, rejects when unscorable", () => {
  assert.equal(evaluateShot({ faceCosine: 0.8, sceneScore: 0.8 }, DEFAULT_THRESHOLDS).pass, true);
  const low = evaluateShot({ faceCosine: 0.2, sceneScore: 0.8 }, DEFAULT_THRESHOLDS);
  assert.equal(low.pass, false);
  assert.deepEqual(low.reasons, ["face_below_threshold"]);
  assert.deepEqual(evaluateShot({ faceCosine: null, sceneScore: null }, DEFAULT_THRESHOLDS).reasons, ["unscorable"]);
});

test("QA LOOP: a below-threshold shot is auto-rejected and regenerated, attempts logged pass/fail", async () => {
  // First shot fails face consistency, second passes.
  const scorer = new ScriptedScorer([
    { faceCosine: 0.2, sceneScore: 0.9 },
    { faceCosine: 0.9, sceneScore: 0.9 },
  ]);
  const res = await produceConsistentShot({
    brief: BRIEF,
    params: { prompt: "hero walks" },
    scorer,
    policy: { maxAttempts: 3 },
    ...shared(),
  });
  assert.ok(res.accepted, "a shot eventually passes");
  assert.equal(res.attempts.length, 2);
  assert.equal(res.attempts[0].pass, false);
  assert.equal(res.attempts[0].reason, "face_below_threshold");
  assert.equal(res.attempts[1].pass, true);
  assert.equal(res.passRate, 0.5);
  assert.ok(res.spentUsd > 0);
  assert.equal(res.paused, false);
});

test("QA LOOP exhausts attempts when nothing passes (no accepted shot)", async () => {
  const scorer = new ScriptedScorer([{ faceCosine: 0.1, sceneScore: 0.1 }]); // always fails
  const res = await produceConsistentShot({
    brief: BRIEF,
    params: { prompt: "x" },
    scorer,
    policy: { maxAttempts: 3 },
    ...shared(),
  });
  assert.equal(res.accepted, null);
  assert.equal(res.attempts.length, 3);
  assert.equal(res.passRate, 0);
});

test("COST GATE: a retry that would exceed budget pauses the run (including its retries)", async () => {
  // Each attempt costs 0.1*5 = 0.5. Budget 0.6 affords exactly one attempt; the retry must pause.
  const scorer = new ScriptedScorer([{ faceCosine: 0.1, sceneScore: 0.1 }]); // always fails -> forces retries
  const res = await produceConsistentShot({
    brief: BRIEF,
    params: { prompt: "x" },
    scorer,
    policy: { maxAttempts: 5 },
    ...shared({ budget: { capUsd: 0.6, spentUsd: 0 } }),
  });
  assert.equal(res.paused, true);
  assert.match(res.pauseReason ?? "", /over budget/);
  // One real attempt (0.5 spent), then the second attempt is the pause record (cost 0).
  assert.equal(res.attempts.length, 2);
  assert.equal(res.attempts[1].reason.startsWith("paused_over_budget"), true);
  assert.ok(res.spentUsd <= 0.6);
});

test("PROVIDER SWITCH: providerOrder rotates the provider on each retry", async () => {
  const scorer = new ScriptedScorer([
    { faceCosine: 0.1, sceneScore: 0.1 }, // attempt 1 fails (providerA)
    { faceCosine: 0.9, sceneScore: 0.9 }, // attempt 2 passes (providerB)
  ]);
  const res = await produceConsistentShot({
    brief: BRIEF,
    params: { prompt: "x" },
    scorer,
    policy: { maxAttempts: 3, providerOrder: ["providerA", "providerB"] },
    ...shared(),
  });
  assert.equal(res.attempts[0].provider, "providerA");
  assert.equal(res.attempts[1].provider, "providerB");
  assert.ok(res.accepted);
});

test("CHAINING: a character holds across multiple FLF-anchored segments above threshold", async () => {
  const segs = [
    { brief: BRIEF, params: { prompt: "seg1" } },
    { brief: BRIEF, params: { prompt: "seg2" } },
    { brief: BRIEF, params: { prompt: "seg3" } },
  ];
  // Every segment passes on the first try.
  const res = await chainSegments(segs, {
    scorer: new ScriptedScorer([{ faceCosine: 0.9, sceneScore: 0.9 }]),
    policy: { maxAttempts: 2, reanchorOnFail: true },
    ...shared(),
  });
  assert.equal(res.held, true);
  assert.equal(res.segments.length, 3);
  assert.equal(res.overallPassRate, 1);
  // FLF: segments 2 and 3 were anchored on the prior accepted frame.
  assert.ok(res.segments.every((s) => s.accepted));
});

test("CHAINING: the chain stops when a segment cannot lock the character", async () => {
  const segs = [
    { brief: BRIEF, params: { prompt: "seg1" } },
    { brief: BRIEF, params: { prompt: "seg2" } },
  ];
  // Segment 1 passes; segment 2 never passes -> chain does not hold and stops.
  let call = 0;
  const scorer = {
    async scoreShot(): Promise<ShotScore> {
      call += 1;
      return call === 1 ? { faceCosine: 0.9, sceneScore: 0.9 } : { faceCosine: 0.1, sceneScore: 0.1 };
    },
  };
  const res = await chainSegments(segs, { scorer, policy: { maxAttempts: 2 }, ...shared() });
  assert.equal(res.held, false);
  assert.equal(res.segments.length, 2);
  assert.equal(res.segments[1].accepted, null);
});

test("CONSENT GATE: a B_likeness generation without current consent is blocked", async () => {
  const gate = new InMemoryConsentGate();
  assert.equal(tierNeedsConsent("B_likeness"), true);
  assert.equal(tierNeedsConsent("A_filmed"), false);
  assert.equal(tierNeedsConsent("C_ai"), false);

  // No consent ref -> blocked.
  await assert.rejects(guardLikenessConsent(gate, "B_likeness", null), ConsentBlockedError);
  // A ref that was never granted -> blocked.
  await assert.rejects(guardLikenessConsent(gate, "B_likeness", "consent-1"), ConsentBlockedError);
  // Grant it -> allowed.
  gate.grant("consent-1");
  await assert.doesNotReject(guardLikenessConsent(gate, "B_likeness", "consent-1"));
  // Revoke -> blocked again.
  gate.revoke("consent-1");
  await assert.rejects(guardLikenessConsent(gate, "B_likeness", "consent-1"), ConsentBlockedError);
  // C_ai (no real likeness) needs no consent.
  await assert.doesNotReject(guardLikenessConsent(gate, "C_ai", null));
});

test("passRate is 0 for no attempts", () => {
  assert.equal(passRate([]), 0);
});
