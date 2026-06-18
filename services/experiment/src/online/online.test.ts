// Tests for the ONLINE experiment serving tier (Slice B). Runner: node --test with tsx (NodeNext .js
// specifiers resolve to .ts). These pin the load-bearing properties: assignment determinism, epsilon
// exploration with a seeded RNG, the accessibility-first always-eligible rule, propensity bookkeeping,
// and the HARD GATE that reward weights are NOT applied while unsigned. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REWARD_WEIGHTS_SIGNED_OFF,
  getWeights,
  bucketOf,
  mulberry32,
  epsilonGreedy,
  eligibleArms,
  ctr,
  cpa,
  armFromStats,
  emptyStats,
  type Arm,
} from "./bandit-core.js";
import { assignDeterministic, assignBandit } from "./assign.js";
import { route, type AppDeps } from "./http/app.js";
import { InMemoryExperimentStore } from "./store.js";
import { InMemoryPosterCandidateStore } from "./poster-candidates.js";
import { testSessionVerifier } from "./http/auth.js";

// ---- the gate: weights are NOT signed off, and are display-only ----

test("gate: REWARD_WEIGHTS_SIGNED_OFF is false", () => {
  assert.equal(REWARD_WEIGHTS_SIGNED_OFF, false);
});

test("gate: getWeights is neutral (all zero) while unsigned, so no signal can tilt selection", () => {
  const w = getWeights();
  assert.equal(w.ctr, 0);
  assert.equal(w.cpa, 0);
  assert.equal(w.completion, 0);
});

test("gate: a high measured rewardEstimate does NOT win while unsigned (reward not applied)", () => {
  // Arm "z" has a far higher reward estimate, but while unsigned the exploit branch is reward-insensitive
  // and tie-breaks on lowest id, so "a" wins. This is the anti-extraction property.
  const arms: Arm[] = [
    { id: "a", rewardEstimate: 0.01, eligible: true },
    { id: "z", rewardEstimate: 0.99, eligible: true },
  ];
  // rng() first draw >= epsilon -> exploit branch. Use epsilon 0 to force exploit.
  const sel = epsilonGreedy(arms, 0, mulberry32(123));
  assert.equal(sel.explored, false);
  assert.equal(sel.rewardApplied, false);
  assert.equal(sel.chosen, "a"); // lowest id, NOT the high-reward arm
});

// ---- deterministic A/B assignment ----

test("assign: deterministic, same (unit, experiment) always lands in the same bucket and variant", () => {
  const b1 = bucketOf("user-1", "exp-A", "salt");
  const b2 = bucketOf("user-1", "exp-A", "salt");
  assert.deepEqual(b1, b2);

  const variants = [
    { id: "control", weight: 0.5 },
    { id: "treatment", weight: 0.5 },
  ];
  const a1 = assignDeterministic("user-1", "exp-A", variants);
  const a2 = assignDeterministic("user-1", "exp-A", variants);
  assert.equal(a1.variant, a2.variant);
  assert.equal(a1.bucket, a2.bucket);
});

test("assign: different salts reshuffle assignment", () => {
  // Across many units the salt must change at least one assignment (it reshuffles the hash space).
  let differs = false;
  for (let i = 0; i < 50; i++) {
    const u = `user-${i}`;
    const a = bucketOf(u, "exp", "salt-1").intBucket;
    const b = bucketOf(u, "exp", "salt-2").intBucket;
    if (a !== b) differs = true;
  }
  assert.equal(differs, true);
});

test("assign: weighted split honors approximate proportions over many units", () => {
  const variants = [
    { id: "control", weight: 0.9 },
    { id: "treatment", weight: 0.1 },
  ];
  let treatment = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    if (assignDeterministic(`u-${i}`, "split-exp", variants).variant === "treatment") treatment++;
  }
  const share = treatment / N;
  // 10 percent target, allow a generous band for a finite hash sample.
  assert.ok(share > 0.06 && share < 0.14, `treatment share ${share} out of band`);
});

test("assign: propensity equals the normalized variant weight", () => {
  const variants = [
    { id: "control", weight: 3 },
    { id: "treatment", weight: 1 },
  ];
  const a = assignDeterministic("u", "p-exp", variants);
  const expected = a.variant === "control" ? 3 / 4 : 1 / 4;
  assert.equal(a.propensity, expected);
});

// ---- epsilon exploration with a seeded RNG ----

test("epsilon: rng draw below epsilon explores; at or above exploits", () => {
  const arms: Arm[] = [
    { id: "a", rewardEstimate: 0, eligible: true },
    { id: "b", rewardEstimate: 0, eligible: true },
  ];
  // Force explore: first draw 0.0 < epsilon, second draw selects index 1 -> "b".
  const exploreRng = makeRng([0.0, 0.99]);
  const explored = epsilonGreedy(arms, 0.5, exploreRng);
  assert.equal(explored.explored, true);
  assert.equal(explored.chosen, "b");

  // Force exploit: first draw 0.9 >= epsilon -> exploit -> lowest id "a".
  const exploitRng = makeRng([0.9]);
  const exploited = epsilonGreedy(arms, 0.5, exploitRng);
  assert.equal(exploited.explored, false);
  assert.equal(exploited.chosen, "a");
});

test("epsilon: exploration rate is approximately epsilon over many seeds", () => {
  const arms: Arm[] = [
    { id: "a", rewardEstimate: 0, eligible: true },
    { id: "b", rewardEstimate: 0, eligible: true },
  ];
  const eps = 0.3;
  let explored = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    if (epsilonGreedy(arms, eps, mulberry32(i + 1)).explored) explored++;
  }
  const rate = explored / N;
  assert.ok(Math.abs(rate - eps) < 0.05, `explore rate ${rate} far from ${eps}`);
});

test("epsilon: propensity is exact and strictly positive", () => {
  const arms: Arm[] = [
    { id: "a", rewardEstimate: 0, eligible: true },
    { id: "b", rewardEstimate: 0, eligible: true },
    { id: "c", rewardEstimate: 0, eligible: true },
  ];
  const eps = 0.3;
  // Exploit arm is "a" (lowest id, reward-neutral). Its mass = eps/n + (1-eps).
  const exploit = epsilonGreedy(arms, eps, makeRng([0.99]));
  assert.equal(exploit.chosen, "a");
  assert.ok(Math.abs(exploit.propensity - (eps / 3 + (1 - eps))) < 1e-9);
  // An explored non-exploit arm carries mass eps/n.
  const explore = epsilonGreedy(arms, eps, makeRng([0.0, 0.5]));
  assert.equal(explore.explored, true);
  assert.ok(explore.propensity > 0);
  assert.ok(Math.abs(explore.propensity - eps / 3) < 1e-9);
});

test("epsilon: single eligible arm gets propensity 1 and never explores", () => {
  const sel = epsilonGreedy([{ id: "only", rewardEstimate: 0.5, eligible: true }], 0.9, mulberry32(7));
  assert.equal(sel.chosen, "only");
  assert.equal(sel.propensity, 1);
  assert.equal(sel.explored, false);
});

// ---- accessibility-first always eligible ----

test("a11y: an accessibility-first variant is always eligible even when marked ineligible", () => {
  const arms: Arm[] = [
    { id: "a11y:high-contrast", rewardEstimate: 0, eligible: false, alwaysEligible: true },
    { id: "glossy", rewardEstimate: 0.9, eligible: false },
  ];
  const pool = eligibleArms(arms);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "a11y:high-contrast");
});

test("a11y: poster select keeps the accessibility-first variant in the running (25-D2 contract)", async () => {
  // 25-D2: /poster/select takes set=<seriesId> and resolves the candidate SET from the candidate store.
  const store = new InMemoryExperimentStore();
  const posterCandidates = new InMemoryPosterCandidateStore();
  posterCandidates.set("series-x", [
    { posterId: "glossy", url: "https://cdn/glossy.jpg", emotion: null, character: null, language: null, accessibilityFirst: false },
    { posterId: "hc", url: "https://cdn/hc.jpg", emotion: null, character: null, language: null, accessibilityFirst: true },
  ]);
  const deps: AppDeps = { store, posterCandidates, session: testSessionVerifier() };
  // Give the glossy poster a huge measured CTR; while unsigned it must not be able to evict the a11y one.
  for (let i = 0; i < 100; i++) {
    await deps.store.recordImpression("poster:series-x", "series-x:glossy");
    await deps.store.recordClick("poster:series-x", "series-x:glossy");
  }
  const q = new URLSearchParams({ set: "series-x", unit: "u1", epsilon: "0" });
  const res = await route("GET", "/poster/select", q, undefined, null, deps);
  assert.equal(res.status, 200);
  const body = res.body as { posterId: string; accessibilityFirst: boolean; rewardApplied: boolean };
  // Exploit branch, reward not applied while unsigned -> lowest arm id wins -> the a11y candidate.
  assert.equal(body.rewardApplied, false);
  assert.equal(body.posterId, "hc");
  assert.equal(body.accessibilityFirst, true);
});

// ---- ctr / cpa helpers ----

test("stats: smoothed ctr and cpa behave on empty and populated arms", () => {
  assert.equal(ctr(emptyStats()), 0.5); // (0+1)/(0+2)
  assert.equal(cpa(emptyStats()), null);
  const s = { impressions: 8, clicks: 2, conversions: 2, cost: 10 };
  assert.ok(Math.abs(ctr(s) - 3 / 10) < 1e-9);
  assert.equal(cpa(s), 5);
  const arm = armFromStats("x", s, { alwaysEligible: true });
  assert.equal(arm.alwaysEligible, true);
  assert.ok(Math.abs(arm.rewardEstimate - 3 / 10) < 1e-9);
});

// ---- HTTP routing ----

test("http: POST /assign deterministic split returns a stable variant", async () => {
  const deps = mkDeps();
  const body = { unit: "u-42", experiment: "exp-1", variants: ["control", "treatment"] };
  const r1 = await route("POST", "/assign", new URLSearchParams(), body, null, deps);
  const r2 = await route("POST", "/assign", new URLSearchParams(), body, null, deps);
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body, r2.body);
});

test("http: POST /assign bandit mode logs propensity and does not apply reward unsigned", async () => {
  const deps = mkDeps();
  const body = {
    unit: "u-1",
    experiment: "exp-b",
    epsilon: 0,
    arms: [
      { id: "a", rewardEstimate: 0.1 },
      { id: "z", rewardEstimate: 0.9 },
    ],
  };
  const r = await route("POST", "/assign", new URLSearchParams(), body, null, deps);
  const out = r.body as { variant: string; propensity: number; rewardApplied: boolean };
  assert.equal(out.rewardApplied, false);
  assert.equal(out.variant, "a"); // not the high-reward "z"
  assert.ok(out.propensity > 0);
});

test("http: POST /ending uses session subject as the bucketing unit when authenticated", async () => {
  const deps = mkDeps();
  const uuid = "11111111-2222-3333-4444-555555555555";
  const body = { experiment: "ending-exp", endings: ["hopeful", "bleak"] };
  const r = await route("POST", "/ending", new URLSearchParams(), body, `Bearer session:${uuid}`, deps);
  assert.equal(r.status, 200);
  const out = r.body as { ending: string; unit: string };
  assert.equal(out.unit, uuid);
  // Same subject is stable across calls.
  const r2 = await route("POST", "/ending", new URLSearchParams(), body, `Bearer session:${uuid}`, deps);
  assert.equal((r2.body as { ending: string }).ending, out.ending);
});

test("http: creative impression then outcome accumulates stats in the store", async () => {
  const deps = mkDeps();
  await route("POST", "/creative/impression", new URLSearchParams(), { experiment: "c", armId: "ad1" }, null, deps);
  await route("POST", "/creative/outcome", new URLSearchParams(), { experiment: "c", armId: "ad1", conversion: true, cost: 4 }, null, deps);
  const s = await deps.store.stats("c", "ad1");
  assert.equal(s.impressions, 1);
  assert.equal(s.clicks, 1);
  assert.equal(s.conversions, 1);
  assert.equal(s.cost, 4);
});

test("http: GET /weights exposes the display-only gate state", async () => {
  const deps = mkDeps();
  const r = await route("GET", "/weights", new URLSearchParams(), undefined, null, deps);
  assert.equal(r.status, 200);
  const out = r.body as { signedOff: boolean; weights: { ctr: number } };
  assert.equal(out.signedOff, false);
  assert.equal(out.weights.ctr, 0);
});

test("http: malformed POST body is a 400, unknown route is a 404", async () => {
  const deps = mkDeps();
  const bad = await route("POST", "/assign", new URLSearchParams(), null, null, deps);
  assert.equal(bad.status, 400);
  const missing = await route("GET", "/nope", new URLSearchParams(), undefined, null, deps);
  assert.equal(missing.status, 404);
});

test("http: bandit assignment is deterministic per unit but explores across the population", async () => {
  const deps = mkDeps();
  const arms: Arm[] = [
    { id: "a", rewardEstimate: 0, eligible: true },
    { id: "b", rewardEstimate: 0, eligible: true },
  ];
  // Same unit -> same arm.
  const x1 = assignBandit("unit-x", "e", arms, 0.5);
  const x2 = assignBandit("unit-x", "e", arms, 0.5);
  assert.equal(x1.chosen, x2.chosen);
  // Population sees both arms with epsilon exploration.
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(assignBandit(`u-${i}`, "e", arms, 0.5).chosen);
  assert.equal(seen.size, 2);
});

// ---- helpers ----

// A deterministic RNG that replays a fixed sequence of draws, then 0 forever. Lets a test pin the
// explore/exploit flip and which arm an explore step picks, with no dependence on the PRNG internals.
function makeRng(seq: number[]): () => number {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0);
}

function mkDeps(): AppDeps & { store: InMemoryExperimentStore } {
  return { store: new InMemoryExperimentStore(), session: testSessionVerifier() };
}
