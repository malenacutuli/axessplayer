import { test } from "node:test";
import assert from "node:assert/strict";
import { appendPage, indexFromOffset, initialShortsState, playbackWindow, roleOf, shouldLoadMore } from "./shorts";
import { MOCK_VIDEOS } from "../api/mocks";

const [a, b, c, d] = MOCK_VIDEOS;

test("appendPage dedupes and tracks the cursor", () => {
  let s = appendPage(initialShortsState, { items: [a, b], next_cursor: "2" });
  assert.equal(s.items.length, 2);
  assert.equal(s.done, false);
  s = appendPage(s, { items: [b, c], next_cursor: null });
  assert.deepEqual(s.items.map((v) => v.id), [a.id, b.id, c.id]);
  assert.equal(s.done, true);
});

test("shouldLoadMore near the end, not while loading, done or errored", () => {
  const s = appendPage(initialShortsState, { items: [a, b, c, d], next_cursor: "4" });
  assert.equal(shouldLoadMore(s, 0), false);
  assert.equal(shouldLoadMore(s, 1), true);
  assert.equal(shouldLoadMore({ ...s, loading: true }, 3), false);
  assert.equal(shouldLoadMore({ ...s, done: true }, 3), false);
  assert.equal(shouldLoadMore({ ...s, error: "unavailable" }, 3), false);
  assert.equal(shouldLoadMore(initialShortsState, 0), true);
});

test("playback window: one active, next preloaded, previous mounted, rest released", () => {
  const w = playbackWindow(3, 10);
  assert.deepEqual(w, { active: 3, preload: [4], mounted: [2, 3, 4] });
  assert.equal(roleOf(3, w), "active");
  assert.equal(roleOf(4, w), "preload");
  assert.equal(roleOf(2, w), "mounted");
  assert.equal(roleOf(7, w), "released");
});

test("playback window clamps at the edges", () => {
  assert.deepEqual(playbackWindow(0, 1), { active: 0, preload: [], mounted: [0] });
  assert.deepEqual(playbackWindow(9, 3), { active: 2, preload: [], mounted: [1, 2] });
  assert.deepEqual(playbackWindow(0, 0), { active: -1, preload: [], mounted: [] });
});

test("indexFromOffset snaps to the nearest page", () => {
  assert.equal(indexFromOffset(0, 800, 5), 0);
  assert.equal(indexFromOffset(1250, 800, 5), 2);
  assert.equal(indexFromOffset(99999, 800, 5), 4);
  assert.equal(indexFromOffset(100, 0, 5), 0);
});
