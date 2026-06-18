// Analytics + band-derivation tests against a FAKE pg. Assert BOTH the SQL shape (taxonomy event names,
// the group-by dimension) AND that rows fold into the contract DTOs, including that counterfactual / branch
// lift is ALWAYS a band {low,high,center} and never a point. No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  funnelCountsSql,
  funnelBySeriesSql,
  branchOutcomesSql,
  a11yUsageSql,
  retentionByDaySql,
} from "./queries.js";
import {
  parseDim,
  deriveFunnel,
  deriveBranchLift,
  deriveRetention,
  buildAnalytics,
  buildFunnel,
} from "./analytics.js";
import type { QueryPort } from "./aggregate.js";
import { rateBand, liftBand, bandFromMargin, verdictAroundZero } from "./bands.js";

// ---- Pure band math ---------------------------------------------------------------------------------

test("rateBand: zero trials is a full [0,1] no-evidence band; sparse data is a wide band", () => {
  const none = rateBand(0, 0);
  assert.equal(none.low, 0);
  assert.equal(none.high, 1);

  const sparse = rateBand(2, 3);
  const dense = rateBand(2000, 3000);
  const sparseWidth = sparse.high - sparse.low;
  const denseWidth = dense.high - dense.low;
  assert.ok(sparseWidth > denseWidth, "sparse data must yield a wider band than dense data");
  // Centers are the raw rate.
  assert.ok(Math.abs(sparse.center - 2 / 3) < 1e-9);
});

test("bandFromMargin clamps a negative/NaN margin to a degenerate point band; low<=center<=high", () => {
  const b = bandFromMargin(0.5, -1);
  assert.deepEqual(b, { low: 0.5, high: 0.5, center: 0.5 });
  const nan = bandFromMargin(Number.NaN, 0.2);
  assert.equal(nan.center, 0);
});

test("liftBand: equal arms straddle zero => inconclusive; a clear win is decisively up", () => {
  const tie = liftBand(50, 100, 50, 100);
  assert.equal(tie.inconclusive, true, "equal rates must be inconclusive (band spans zero)");
  assert.equal(tie.direction, "none");

  // A large, decisive treatment win with big samples.
  const win = liftBand(900, 1000, 100, 1000);
  assert.equal(win.inconclusive, false);
  assert.equal(win.direction, "up");
  assert.ok(win.band.low > 0, "a decisive win has a band entirely above zero");
  // It is a band, not a point.
  assert.ok(win.band.high > win.band.center && win.band.center > win.band.low);
});

test("verdictAroundZero classifies up/down/none against a reference", () => {
  assert.equal(verdictAroundZero({ low: 0.1, high: 0.2, center: 0.15 }).direction, "up");
  assert.equal(verdictAroundZero({ low: -0.2, high: -0.1, center: -0.15 }).direction, "down");
  assert.equal(verdictAroundZero({ low: -0.1, high: 0.1, center: 0 }).inconclusive, true);
});

// ---- SQL shapes -------------------------------------------------------------------------------------

test("funnel SQL counts the canonical taxonomy stages in one pass over engagement_events", () => {
  const t = funnelCountsSql().text;
  assert.match(t, /from engagement_events/);
  for (const stage of ["impression", "play", "view_3s", "completion_50", "episode_completed"]) {
    assert.match(t, new RegExp(`filter \\(where type = '${stage}'\\)`));
  }
  // The monetized terminal stage maps unlock_purchased -> unlock.
  assert.match(t, /filter \(where type = 'unlock_purchased'\)::int as unlock/);
});

test("by-series funnel joins series for the title and is bounded", () => {
  const s = funnelBySeriesSql(25);
  assert.match(s.text, /join series s on s\.id = e\.series_id/);
  assert.match(s.text, /group by e\.series_id, s\.title/);
  assert.deepEqual(s.values, [25]);
});

test("branch outcomes SQL splits treatment vs control over decision_log, never reading a reward weight", () => {
  const t = branchOutcomesSql().text;
  assert.match(t, /from decision_log/);
  assert.match(t, /filter \(where not is_control\)/);
  assert.match(t, /filter \(where is_control\)/);
  assert.doesNotMatch(t, /weight|w_c|w_r|w_m/i);
});

test("a11y usage SQL counts the toggle events; retention SQL is windowed", () => {
  const a = a11yUsageSql().text;
  assert.match(a, /caption_toggled/);
  assert.match(a, /sign_toggled/);
  assert.match(a, /language_switched/);
  const r = retentionByDaySql(14);
  assert.match(r.text, /first_seen/);
  assert.deepEqual(r.values, ["14"]);
});

// ---- Funnel derivation ------------------------------------------------------------------------------

test("deriveFunnel produces ordered stages with per-stage conversion, no division by zero", () => {
  const stages = deriveFunnel({ impression: 1000, play: 400, view_3s: 300, completion_50: 150, episode_completed: 100, unlock: 10 });
  assert.deepEqual(stages.map((s) => s.stage), ["impression", "play", "view_3s", "completion_50", "episode_completed", "unlock"]);
  assert.equal(stages[0].conversionFromPrev, 1); // entry stage
  assert.ok(Math.abs(stages[1].conversionFromPrev - 0.4) < 1e-9); // 400/1000
  // A zero prior never produces NaN.
  const zero = deriveFunnel({ impression: 0, play: 5, view_3s: 0, completion_50: 0, episode_completed: 0, unlock: 0 });
  assert.equal(zero[1].conversionFromPrev, 0);
});

test("parseDim falls back to funnel for unknown/missing dims", () => {
  assert.equal(parseDim(undefined), "funnel");
  assert.equal(parseDim("nonsense"), "funnel");
  assert.equal(parseDim("branch"), "branch");
  assert.equal(parseDim("retention"), "retention");
});

// ---- Fake pg ----------------------------------------------------------------------------------------

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("buildFunnel folds the single-row counts into the staged funnel", async () => {
  const db = fakePg([{ match: /from engagement_events/, rows: [{ impression: 1000, play: 400, view_3s: 300, completion_50: 150, episode_completed: 100, unlock: 10 }] }]);
  const r = await buildFunnel(db);
  assert.equal(r.dim, "funnel");
  assert.equal(r.stages.length, 6);
  assert.equal(r.stages[0].count, 1000);
});

test("buildAnalytics(dim=branch) returns lift as a band per beat, never a point; ties are inconclusive", async () => {
  const db = fakePg([
    { match: /from decision_log/, rows: [
      { beat_id: "b-tie", treatment_trials: 100, treatment_success: 50, control_trials: 100, control_success: 50 },
      { beat_id: "b-win", treatment_trials: 1000, treatment_success: 900, control_trials: 1000, control_success: 100 },
    ] },
  ]);
  const r = await buildAnalytics(db, "branch");
  assert.equal(r.dim, "branch");
  const branches = (r as { branches: Array<{ beatId: string; lift: { low: number; high: number; center: number }; inconclusive: boolean; direction: string }> }).branches;
  const tie = branches.find((b) => b.beatId === "b-tie")!;
  const win = branches.find((b) => b.beatId === "b-win")!;
  // Every lift carries the band triplet.
  for (const b of branches) {
    assert.ok(typeof b.lift.low === "number" && typeof b.lift.high === "number" && typeof b.lift.center === "number");
    assert.ok(b.lift.low <= b.lift.center && b.lift.center <= b.lift.high, "band must bracket the center");
  }
  assert.equal(tie.inconclusive, true);
  assert.equal(win.inconclusive, false);
  assert.equal(win.direction, "up");
});

test("deriveBranchLift on empty input is an empty list (no fabricated branches)", () => {
  assert.deepEqual(deriveBranchLift([]), []);
});

test("deriveRetention normalizes against the day-0 base, never NaN when the base is empty", () => {
  const curve = deriveRetention([
    { day_offset: 0, users: 100 },
    { day_offset: 1, users: 40 },
    { day_offset: 7, users: 20 },
  ]);
  assert.equal(curve[0].retentionRate, 1);
  assert.ok(Math.abs(curve[1].retentionRate - 0.4) < 1e-9);
  // No day-0 row -> base 0 -> all rates 0, not NaN.
  const noBase = deriveRetention([{ day_offset: 3, users: 10 }]);
  assert.equal(noBase[0].retentionRate, 0);
});
