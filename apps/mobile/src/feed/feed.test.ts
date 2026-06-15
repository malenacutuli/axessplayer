// Feed data/logic tests: the content graph parses into ordered episode cards, the cold-open beat is
// resolved, and a failing series degrades the feed instead of failing it whole. Runner: node --test + tsx.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFeed, toFeedItems } from "./feed.js";
import { parseSeriesGraph } from "./graph.js";
import {
  COLD_OPEN_BEAT,
  EP1_ID,
  EP2_ID,
  SERIES_ID,
  fakeClient,
  sampleSeriesGraph,
} from "../test-support/fixtures.js";

test("parseSeriesGraph flattens episodes in episode-number order with the cold-open beat", () => {
  const graph = parseSeriesGraph(SERIES_ID, sampleSeriesGraph());
  assert.equal(graph.id, SERIES_ID);
  assert.equal(graph.episodes.length, 2);
  assert.deepEqual(graph.episodes.map((e) => e.episodeNumber), [1, 2]);
  assert.equal(graph.episodes[0].coldOpenBeatId, COLD_OPEN_BEAT);
});

test("toFeedItems produces one card per episode with stable keys and free/cost flags", () => {
  const graph = parseSeriesGraph(SERIES_ID, sampleSeriesGraph());
  const items = toFeedItems(graph);
  assert.deepEqual(items.map((i) => i.key), [`${SERIES_ID}:${EP1_ID}`, `${SERIES_ID}:${EP2_ID}`]);
  assert.equal(items[0].isFree, true);
  assert.equal(items[1].isFree, false);
  assert.equal(items[1].coinCost, 80);
  assert.equal(items[0].coldOpenBeatId, COLD_OPEN_BEAT);
});

test("loadFeed loads multiple series and orders cards by series then episode", async () => {
  const client = fakeClient();
  const res = await loadFeed(client, [SERIES_ID]);
  assert.equal(res.failed.length, 0);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].seriesTitle, "The Long Night");
});

test("loadFeed degrades: a failing series is skipped and reported, others still load", async () => {
  const BAD = "00000000-0000-0000-0000-0000000000bad".replace("bad", "0bad");
  const client = fakeClient({
    getSeriesGraph: async (id) => {
      if (id === BAD) throw new Error("404");
      return sampleSeriesGraph();
    },
  });
  const res = await loadFeed(client, [BAD, SERIES_ID]);
  assert.deepEqual(res.failed, [BAD]);
  assert.equal(res.items.length, 2);
});

test("parseSeriesGraph throws on a structurally invalid payload (not an object)", () => {
  assert.throws(() => parseSeriesGraph(SERIES_ID, "nope"));
});
