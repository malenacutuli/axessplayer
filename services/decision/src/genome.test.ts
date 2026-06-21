// K2/T2 genome builder tests: EWMA features from events, neutral priors with no signal, maturity counts,
// archetype assignment, consent fail-closed. No network. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildViewerGenome, buildGenomes, archetypeOf, preferenceVectorPayload, NEUTRAL_PRIOR, GENOME_ATTRIBUTES, type GenomeEvent } from "./genome.js";

const ev = (over: Partial<GenomeEvent>): GenomeEvent => ({ userId: "u1", seriesId: "s1", sessionId: "sess1", type: "impression", completion: null, payload: null, ts: 1, ...over });

test("a viewer with no signal holds the neutral prior on every attribute", () => {
  const g = buildViewerGenome("u1", [ev({ type: "impression", ts: 1 })]);
  for (const a of GENOME_ATTRIBUTES) assert.equal(g.preferenceVector[a], NEUTRAL_PRIOR, `${a} stays neutral`);
  assert.equal(g.nBeatsSeen, 1);
  assert.equal(g.nSessions, 1);
});

test("completion drives completion_propensity up and churn_risk down via EWMA", () => {
  const g = buildViewerGenome("u1", [
    ev({ type: "beat_complete", completion: 1, sessionId: "a", ts: 1 }),
    ev({ type: "beat_complete", completion: 1, sessionId: "a", ts: 2 }),
    ev({ type: "beat_complete", completion: 1, sessionId: "b", ts: 3 }),
  ]);
  assert.ok(g.preferenceVector.completion_propensity > NEUTRAL_PRIOR, "completion propensity rose");
  assert.ok(g.preferenceVector.churn_risk < NEUTRAL_PRIOR, "churn risk fell");
  assert.equal(g.nSessions, 2);
  assert.equal(g.nBeatsSeen, 3);
});

test("explicit payload signals and event types update the right attributes", () => {
  const g = buildViewerGenome("u1", [
    ev({ type: "paywall_presented", payload: { unlocked: true }, ts: 1 }),
    ev({ type: "impression", payload: { captions_on: true, romance_affinity: 0.9 }, ts: 2 }),
  ]);
  assert.ok(g.preferenceVector.unlock_propensity > NEUTRAL_PRIOR);
  assert.ok(g.preferenceVector.caption_reliance > NEUTRAL_PRIOR);
  assert.ok(g.preferenceVector.romance_affinity > NEUTRAL_PRIOR);
});

test("consent fails closed and reads from the latest event that carries it", () => {
  const g = buildViewerGenome("u1", [ev({ type: "impression", ts: 1 }), ev({ type: "impression", payload: { adaptive_opt_in: true, data_capture_consent: true }, ts: 2 })]);
  assert.equal(g.consent.adaptive, true);
  assert.equal(g.consent.data_capture, true);
  // with no consent event at all, both are false (opt-in)
  assert.deepEqual(buildViewerGenome("u2", [ev({ userId: "u2", type: "impression" })]).consent, { adaptive: false, data_capture: false });
});

test("archetype buckets are deterministic", () => {
  assert.equal(archetypeOf({ romance_affinity: 0.5, conflict_tolerance: 0.5, pacing_preference: 0.7, caption_reliance: 0.5, completion_propensity: 0.8, unlock_propensity: 0.5, ad_tolerance: 0.5, brand_receptivity: 0.5, churn_risk: 0.2 }), "binger_fast");
  assert.equal(archetypeOf({ romance_affinity: 0.5, conflict_tolerance: 0.5, pacing_preference: 0.5, caption_reliance: 0.5, completion_propensity: 0.3, unlock_propensity: 0.8, ad_tolerance: 0.5, brand_receptivity: 0.5, churn_risk: 0.3 }), "spender");
  assert.equal(archetypeOf({ romance_affinity: 0.5, conflict_tolerance: 0.5, pacing_preference: 0.5, caption_reliance: 0.5, completion_propensity: 0.3, unlock_propensity: 0.3, ad_tolerance: 0.5, brand_receptivity: 0.5, churn_risk: 0.7 }), "at_risk");
});

test("buildGenomes returns one genome per active viewer and a serialized payload", () => {
  const gs = buildGenomes([ev({ userId: "a", ts: 1 }), ev({ userId: "a", ts: 2 }), ev({ userId: "b", ts: 1 })]);
  assert.equal(gs.length, 2);
  const payload = preferenceVectorPayload(gs[0]);
  assert.equal(payload.schema, "genome.v1");
  assert.ok("completion_propensity" in payload && "archetype_cluster" in payload && "n_sessions" in payload);
});
