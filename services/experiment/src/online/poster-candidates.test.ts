// Tests for the 25-D2 dynamic-poster candidate selection (Slice A). Runner: node --test with tsx (NodeNext
// .js specifiers resolve to .ts). These pin the load-bearing 25-D2 properties:
//   - the accessibility-first candidate is ALWAYS in the eligible set and is the guaranteed fallback;
//   - selection is propensity-logged on the existing epsilon-greedy bandit;
//   - two different viewers can be served different posters (population exploration);
//   - an empty / unwired candidate set falls back cleanly to the single series poster;
//   - the HARD GATE: a high measured CTR cannot evict the accessibility-first variant while unsigned.
// Deterministic: the bandit RNG is seeded from (unit, experiment, salt), so every decision is pinned.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { eligibleArms, epsilonGreedy } from "./bandit-core.js";
import {
  posterArmId,
  posterIdFromArm,
  candidateArms,
  fallbackCandidate,
  UnwiredPosterCandidateStore,
  InMemoryPosterCandidateStore,
  type PosterCandidate,
  type PosterSet,
} from "./poster-candidates.js";
import { route, type AppDeps } from "./http/app.js";
import { InMemoryExperimentStore } from "./store.js";
import { testSessionVerifier } from "./http/auth.js";

// ---- helpers ----

function mkCandidate(over: Partial<PosterCandidate> & { posterId: string }): PosterCandidate {
  return {
    url: `https://cdn.example/${over.posterId}.jpg`,
    emotion: null,
    character: null,
    language: null,
    accessibilityFirst: false,
    ...over,
  };
}

function mkDeps(over: Partial<AppDeps> = {}): AppDeps & {
  store: InMemoryExperimentStore;
  posterCandidates: InMemoryPosterCandidateStore;
} {
  const store = new InMemoryExperimentStore();
  const posterCandidates = new InMemoryPosterCandidateStore();
  return { store, posterCandidates, session: testSessionVerifier(), ...over } as never;
}

const SERIES = "series-1";

function seedSet(pc: InMemoryPosterCandidateStore): void {
  pc.set(SERIES, [
    mkCandidate({ posterId: "joyful", emotion: "joy", character: "ana", language: "es" }),
    mkCandidate({ posterId: "tense", emotion: "tension", character: "leo", language: "es" }),
    mkCandidate({ posterId: "a11y-hc", emotion: "neutral", accessibilityFirst: true }),
  ]);
}

// =====================================================================================================
// pure candidate model
// =====================================================================================================

test("armId: accessibility-first candidate gets the a11y-pinned arm id, scoped by series", () => {
  const a11y = mkCandidate({ posterId: "hc", accessibilityFirst: true });
  const plain = mkCandidate({ posterId: "glossy" });
  assert.equal(posterArmId(SERIES, a11y), "a11y:series-1:hc");
  assert.equal(posterArmId(SERIES, plain), "series-1:glossy");
  // Round-trips back to the posterId for both shapes.
  assert.equal(posterIdFromArm(SERIES, posterArmId(SERIES, a11y)), "hc");
  assert.equal(posterIdFromArm(SERIES, posterArmId(SERIES, plain)), "glossy");
  // An arm id from a different series does not resolve here.
  assert.equal(posterIdFromArm("other", "series-1:glossy"), null);
});

test("a11y: the accessibility-first candidate is ALWAYS in the eligible set", () => {
  const set: PosterSet = {
    seriesId: SERIES,
    source: "candidates",
    candidates: [
      mkCandidate({ posterId: "glossy" }),
      mkCandidate({ posterId: "a11y-hc", accessibilityFirst: true }),
    ],
  };
  // Give glossy a huge reward and mark it the only "eligible" one; the a11y arm is alwaysEligible so it
  // survives the filter regardless.
  const arms = candidateArms(set, (id) => (id.includes("glossy") ? 0.99 : 0.01));
  const a11yArm = arms.find((a) => a.id === "a11y:series-1:a11y-hc");
  assert.ok(a11yArm);
  assert.equal(a11yArm?.alwaysEligible, true);
  // Even if every non-a11y arm is forced ineligible, the a11y arm stays in the pool.
  const forced = arms.map((a) => (a.alwaysEligible ? a : { ...a, eligible: false }));
  const pool = eligibleArms(forced);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "a11y:series-1:a11y-hc");
});

test("gate: a high-CTR candidate cannot evict the accessibility-first variant while unsigned", () => {
  const set: PosterSet = {
    seriesId: SERIES,
    source: "candidates",
    candidates: [
      // Note the posterId orders so the a11y arm id sorts lowest: "a11y:..." < "series-1:...".
      mkCandidate({ posterId: "glossy" }),
      mkCandidate({ posterId: "hc", accessibilityFirst: true }),
    ],
  };
  const arms = candidateArms(set, (id) => (id.includes("glossy") ? 0.99 : 0.01));
  // Force exploit (epsilon 0). While unsigned, reward is not applied: tie-break on lowest arm id, and the
  // a11y arm id ("a11y:...") sorts below "series-1:...", so the accessibility-first poster wins.
  const sel = epsilonGreedy(arms, 0, () => 0.9);
  assert.equal(sel.rewardApplied, false);
  assert.equal(sel.chosen, "a11y:series-1:hc");
});

// =====================================================================================================
// GET /poster/candidates/:seriesId
// =====================================================================================================

test("candidates: unwired store returns an empty set with source 'unwired' (never fabricated)", async () => {
  const store = new UnwiredPosterCandidateStore();
  const set = await store.resolve(SERIES);
  assert.equal(set.candidates.length, 0);
  assert.equal(set.source, "unwired");

  // And over HTTP with no candidate store injected at all.
  const deps: AppDeps = { store: new InMemoryExperimentStore(), session: testSessionVerifier() };
  const r = await route("GET", "/poster/candidates/series-1", new URLSearchParams(), undefined, null, deps);
  assert.equal(r.status, 200);
  const body = r.body as { candidates: unknown[]; source: string };
  assert.equal(body.candidates.length, 0);
  assert.equal(body.source, "unwired");
});

test("candidates: a seeded set is returned with source 'candidates'", async () => {
  const deps = mkDeps();
  seedSet(deps.posterCandidates);
  const r = await route("GET", "/poster/candidates/series-1", new URLSearchParams(), undefined, null, deps);
  assert.equal(r.status, 200);
  const body = r.body as { candidates: PosterCandidate[]; source: string };
  assert.equal(body.source, "candidates");
  assert.equal(body.candidates.length, 3);
  assert.equal(body.candidates.filter((c) => c.accessibilityFirst).length, 1);
});

test("candidates: a missing seriesId path segment is a 400", async () => {
  const deps = mkDeps();
  const r = await route("GET", "/poster/candidates/", new URLSearchParams(), undefined, null, deps);
  assert.equal(r.status, 400);
});

// =====================================================================================================
// GET /poster/select
// =====================================================================================================

test("select: empty/unwired set falls back cleanly to the single series poster_url", async () => {
  // No candidate store injected -> unwired -> fallback to the supplied posterUrl as the a11y variant.
  const deps: AppDeps = { store: new InMemoryExperimentStore(), session: testSessionVerifier() };
  const q = new URLSearchParams({ set: SERIES, unit: "viewer-1", posterUrl: "https://cdn/x.jpg" });
  const r = await route("GET", "/poster/select", q, undefined, null, deps);
  assert.equal(r.status, 200);
  const body = r.body as {
    posterId: string;
    url: string;
    accessibilityFirst: boolean;
    source: string;
    propensity: number;
  };
  assert.equal(body.source, "fallback");
  assert.equal(body.posterId, "series-default");
  assert.equal(body.url, "https://cdn/x.jpg");
  assert.equal(body.accessibilityFirst, true);
  assert.equal(body.propensity, 1); // single eligible arm
});

test("select: missing set (seriesId) is a 400", async () => {
  const deps = mkDeps();
  const r = await route("GET", "/poster/select", new URLSearchParams({ unit: "v" }), undefined, null, deps);
  assert.equal(r.status, 400);
});

test("select: propensity is logged and strictly positive on a multi-candidate set", async () => {
  const deps = mkDeps();
  seedSet(deps.posterCandidates);
  const q = new URLSearchParams({ set: SERIES, unit: "viewer-1", epsilon: "0.3" });
  const r = await route("GET", "/poster/select", q, undefined, null, deps);
  assert.equal(r.status, 200);
  const body = r.body as { propensity: number; rewardApplied: boolean; posterId: string };
  assert.ok(body.propensity > 0, "propensity must be strictly positive for IPS");
  assert.equal(body.rewardApplied, false); // gate: reward not applied while unsigned
  assert.ok(body.posterId.length > 0);
});

test("select: deterministic per viewer, but two different viewers can get different posters", async () => {
  const deps = mkDeps();
  seedSet(deps.posterCandidates);
  // Same viewer -> stable choice across calls.
  const sel = async (unit: string) => {
    const q = new URLSearchParams({ set: SERIES, unit, epsilon: "0.5" });
    const r = await route("GET", "/poster/select", q, undefined, null, deps);
    return (r.body as { posterId: string }).posterId;
  };
  const a1 = await sel("viewer-A");
  const a2 = await sel("viewer-A");
  assert.equal(a1, a2);
  // Across a population of viewers, more than one distinct poster is served (taste profiles differ).
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(await sel(`viewer-${i}`));
  assert.ok(seen.size >= 2, `expected >=2 distinct posters across viewers, saw ${seen.size}`);
});

test("select: accessibility-first candidate is the exploit winner while unsigned (highest CTR ignored)", async () => {
  const deps = mkDeps();
  deps.posterCandidates.set(SERIES, [
    mkCandidate({ posterId: "glossy" }),
    mkCandidate({ posterId: "hc", accessibilityFirst: true }),
  ]);
  // Hammer the glossy poster's CTR up via the impression/click endpoints.
  for (let i = 0; i < 100; i++) {
    await route("POST", "/poster/impression", new URLSearchParams(), { seriesId: SERIES, posterId: "glossy" }, null, deps);
    await route("POST", "/poster/click", new URLSearchParams(), { seriesId: SERIES, posterId: "glossy" }, null, deps);
  }
  // epsilon 0 -> exploit. While unsigned the high CTR is ignored; lowest arm id ("a11y:...") wins.
  const q = new URLSearchParams({ set: SERIES, unit: "viewer-1", epsilon: "0" });
  const r = await route("GET", "/poster/select", q, undefined, null, deps);
  const body = r.body as { posterId: string; accessibilityFirst: boolean; rewardApplied: boolean };
  assert.equal(body.rewardApplied, false);
  assert.equal(body.posterId, "hc");
  assert.equal(body.accessibilityFirst, true);
});

// =====================================================================================================
// poster impression / click feed the bandit keyed on (seriesId, posterId, viewer)
// =====================================================================================================

test("events: poster impression/click key on (seriesId, posterId) and feed the matching arm", async () => {
  const deps = mkDeps();
  seedSet(deps.posterCandidates);
  const armId = posterArmId(SERIES, mkCandidate({ posterId: "joyful" }));
  await route("POST", "/poster/impression", new URLSearchParams(), { seriesId: SERIES, posterId: "joyful" }, null, deps);
  await route("POST", "/poster/impression", new URLSearchParams(), { seriesId: SERIES, posterId: "joyful" }, null, deps);
  await route("POST", "/poster/click", new URLSearchParams(), { seriesId: SERIES, posterId: "joyful" }, null, deps);
  const s = await deps.store.stats(`poster:${SERIES}`, armId);
  assert.equal(s.impressions, 2);
  assert.equal(s.clicks, 1);
  // A different series with the same posterId does NOT collide.
  const otherArm = posterArmId("series-2", mkCandidate({ posterId: "joyful" }));
  const sOther = await deps.store.stats("poster:series-2", otherArm);
  assert.equal(sOther.impressions, 0);
});

test("events: an a11y poster click keys to the a11y-pinned arm when accessibilityFirst is set", async () => {
  const deps = mkDeps();
  await route("POST", "/poster/click", new URLSearchParams(), { seriesId: SERIES, posterId: "hc", accessibilityFirst: true }, null, deps);
  const s = await deps.store.stats(`poster:${SERIES}`, "a11y:series-1:hc");
  assert.equal(s.clicks, 1);
});

test("events: a poster event missing seriesId/posterId is a 400", async () => {
  const deps = mkDeps();
  const r = await route("POST", "/poster/impression", new URLSearchParams(), { posterId: "x" }, null, deps);
  assert.equal(r.status, 400);
});

test("fallback: fallbackCandidate is the accessibility-first variant with no fabricated tags", () => {
  const c = fallbackCandidate(SERIES, "https://cdn/p.jpg");
  assert.equal(c.accessibilityFirst, true);
  assert.equal(c.url, "https://cdn/p.jpg");
  assert.equal(c.emotion, null);
  assert.equal(c.character, null);
  assert.equal(c.language, null);
});
