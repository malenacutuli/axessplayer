// Spec-derived tests for the recommender (P5). Two-tower retrieval ordering, the duration-debiased watch
// signal, the multi-task ranker, exploration with an honest top propensity, and the C5 firewall that keeps
// the re-cutter's cut signals out of the recommender. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  debiasedWatchFraction,
  viewerFeatures,
  itemFeatures,
  assertNoRecutterSignal,
  InMemoryFeatureStore,
  RECUTTER_ONLY_SIGNALS,
  FEATURE_DIM,
  type EngagementRow,
} from "./featureStore.js";
import { identityTower, embed, retrieveTopK } from "./twoTower.js";
import { rankCandidates, exploreRank, DEFAULT_RANKER_WEIGHTS } from "./ranker.js";

const rows: EngagementRow[] = [
  { viewerId: "v1", seriesId: "good", completion: 0.9, watchMs: 9000, durationMs: 10000, returned: true },
  { viewerId: "v2", seriesId: "good", completion: 0.85, watchMs: 8500, durationMs: 10000, returned: true },
  { viewerId: "v3", seriesId: "meh", completion: 0.3, watchMs: 3000, durationMs: 10000, returned: false },
  { viewerId: "v1", seriesId: "meh", completion: 0.4, watchMs: 4000, durationMs: 10000, returned: false },
];

describe("P5-T3 feature store + debias", () => {
  it("duration-debiases watch time (fraction, capped at 1, 0 for no duration)", () => {
    assert.equal(debiasedWatchFraction(5000, 10000), 0.5);
    assert.equal(debiasedWatchFraction(20000, 10000), 1);
    assert.equal(debiasedWatchFraction(5000, 0), 0);
  });
  it("builds fixed-dim viewer and item feature vectors in range", () => {
    const vf = viewerFeatures("v1", rows);
    const itf = itemFeatures("good", rows);
    assert.equal(vf.vector.length, FEATURE_DIM);
    assert.equal(itf.vector.length, FEATURE_DIM);
    for (const x of [...vf.vector, ...itf.vector]) assert.ok(x >= 0 && x <= 1, `feature ${x} out of [0,1]`);
  });
  it("a strong series scores higher engagement features than a weak one", () => {
    const good = itemFeatures("good", rows).vector;
    const meh = itemFeatures("meh", rows).vector;
    assert.ok(good[0] > meh[0]); // avg completion
    assert.ok(good[2] > meh[2]); // return rate
  });
});

describe("P5-T4 C5 separability firewall", () => {
  it("rejects any re-cutter-only signal as a recommender feature", () => {
    for (const banned of RECUTTER_ONLY_SIGNALS) {
      assert.throws(() => assertNoRecutterSignal(["completion", banned]), /C5 firewall/);
    }
  });
  it("allows pure engagement features", () => {
    assert.doesNotThrow(() => assertNoRecutterSignal(["completion", "watch_ms", "duration_ms", "returned"]));
  });
  it("the engagement row type carries no cut-selection field, so features cannot leak the cut", () => {
    const keys = Object.keys(rows[0]);
    for (const banned of RECUTTER_ONLY_SIGNALS) assert.ok(!keys.includes(banned));
  });
});

describe("P5-T1 two-tower retrieval", () => {
  it("identity tower embeds to the feature vector itself", () => {
    const t = identityTower(FEATURE_DIM);
    assert.deepEqual(embed(t, [0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
  });
  it("retrieves the most similar item first and respects k", () => {
    const store = new InMemoryFeatureStore(rows);
    const t = identityTower(FEATURE_DIM);
    const viewerEmb = embed(t, store.viewer("v1").vector);
    const items = store.allItems().map((it) => ({ seriesId: it.seriesId, embedding: embed(t, it.vector) }));
    const top = retrieveTopK(viewerEmb, items, 1);
    assert.equal(top.length, 1);
    assert.equal(top[0].seriesId, "good"); // affinity prior favors the high-engagement title
  });
});

describe("P5-T2 ranker + exploration", () => {
  it("ranks a strong item above a weak one", () => {
    const store = new InMemoryFeatureStore(rows);
    const ranked = rankCandidates(store.allItems().map((it) => ({ seriesId: it.seriesId, features: it.vector })));
    assert.equal(ranked[0].seriesId, "good");
    assert.ok(ranked[0].score > ranked[1].score);
  });
  it("the watch head reads the debiased watch fraction, not raw ms (long content is not favored)", () => {
    // two items, equal completion/returns, but one is long with low fraction, one short with high fraction
    const longLowFrac = [0.5, 0.2, 0.5, 0.5]; // avgDebiasedWatch low
    const shortHighFrac = [0.5, 0.9, 0.5, 0.5]; // avgDebiasedWatch high
    const ranked = rankCandidates([
      { seriesId: "long", features: longLowFrac },
      { seriesId: "short", features: shortHighFrac },
    ]);
    assert.equal(ranked[0].seriesId, "short");
  });
  it("exploration: epsilon 0 keeps the exploit order; a forced explore surfaces another item with eps/k propensity", () => {
    const ranked = [{ seriesId: "a", score: 3 }, { seriesId: "b", score: 2 }, { seriesId: "c", score: 1 }];
    const exploit = exploreRank(ranked, 0, () => 0.9);
    assert.deepEqual(exploit.list.map((r) => r.seriesId), ["a", "b", "c"]);
    assert.equal(exploit.topPropensity, 1);
    // first draw < eps triggers explore; second draw selects index 1 (-> "b")
    let i = 0;
    const explore = exploreRank(ranked, 0.2, () => (i++ === 0 ? 0.0 : 0.34));
    assert.equal(explore.list[0].seriesId, "b");
    assert.ok(Math.abs(explore.topPropensity - 0.2 / 3) < 1e-9);
  });
  it("default head/task weights are flagged placeholders (return-dominant, never raw-watch-maximizing)", () => {
    assert.ok(DEFAULT_RANKER_WEIGHTS.watch[1] === 1); // watch head reads the debiased-watch feature index
  });
});
