import { test } from "node:test";
import assert from "node:assert/strict";
import { QuartileTracker, type TrackerEvent } from "./quartiles";

function run(t: QuartileTracker, positions: number[], duration: number | null): TrackerEvent[] {
  return positions.flatMap((p) => t.update(p, duration));
}

test("continuous playback fires play, 25, 50, 75, complete exactly once", () => {
  const t = new QuartileTracker();
  const ticks = Array.from({ length: 41 }, (_, i) => i * 1000);
  const evs = run(t, ticks, 40000);
  assert.deepEqual(evs.map((e) => (e.type === "quartile" ? `q${e.value}` : e.type)), ["play", "q25", "q50", "q75", "complete"]);
  assert.deepEqual(run(t, [40000, 40000], 40000), []);
  assert.deepEqual(t.ended(40000), []);
});

test("a forward seek emits seek and does not credit skipped quartiles", () => {
  const t = new QuartileTracker();
  const evs = run(t, [0, 1000, 31000, 32000], 40000);
  assert.deepEqual(evs.map((e) => e.type), ["play", "seek"]);
  const after = run(t, [33000, 34000], 40000);
  assert.deepEqual(after, []);
});

test("a backward seek is a seek too", () => {
  const t = new QuartileTracker();
  const evs = run(t, [0, 1000, 2000, 500], 40000);
  assert.equal(evs.at(-1)?.type, "seek");
});

test("unknown duration: no quartiles, but ended() still completes", () => {
  const t = new QuartileTracker();
  assert.deepEqual(run(t, [0, 1000, 2000], null).map((e) => e.type), ["play"]);
  assert.deepEqual(t.ended(2000), [{ type: "complete", position_ms: 2000 }]);
});

test("reset starts a new playthrough (shorts loop)", () => {
  const t = new QuartileTracker();
  run(t, [0, 1000, 2000, 3000, 4000], 4000);
  t.reset();
  const evs = run(t, [0, 1000], 4000);
  assert.deepEqual(evs.map((e) => (e.type === "quartile" ? `q${e.value}` : e.type)), ["play", "q25"]);
});
