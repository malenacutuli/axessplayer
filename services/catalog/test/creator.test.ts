// Unit tests for the CREATOR-SCOPED catalog logic: the branch-editor graph composition (node-kind
// labeling, default-edge derivation, canon validity) and the series analytics aggregation (beat retention
// shape, off-policy lift as a BAND never a point, ending distribution, funnel, completion, cohort slices).
// Run with node:test against a FAKE pg: the fake records (text, values) and returns canned rows, so the
// tests assert SQL SHAPE and pure derivation without a real database. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSeriesExistsQuery,
  buildGraphBeatsQuery,
  buildGraphVariantFlagsQuery,
  buildGraphEdgesQuery,
  composeSeriesGraph,
  edgeChoiceLabel,
  axisOf,
  buildBeatRetentionQuery,
  mapBeatRetention,
  buildBranchPerformanceQuery,
  mapBranchPerformance,
  buildEndingDistributionQuery,
  mapEndingDistribution,
  buildSeriesFunnelQuery,
  deriveSeriesFunnel,
  buildSeriesCompletionQuery,
  mapCompletion,
  buildCohortFunnelQuery,
  mapCohortSlices,
  SERIES_FUNNEL_STAGES,
  type Queryable,
} from "../src/queries.js";
import {
  checkCanon,
  labelNodeKind,
  type GraphEdge,
  type GraphNode,
} from "../src/storygraph.js";
import { liftBand, rateBand, bandFromMargin } from "../src/bands.js";

function fakePg(resultQueue: Array<Array<Record<string, unknown>>>): {
  db: Queryable;
  calls: Array<{ text: string; values: unknown[] }>;
} {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let i = 0;
  const db: Queryable = {
    async query(text, values) {
      calls.push({ text, values: values ?? [] });
      const rows = resultQueue[i] ?? [];
      i += 1;
      return { rows };
    },
  };
  return { db, calls };
}

// ---- storygraph: node-kind labeling -----------------------------------------------------------------

test("labelNodeKind precedence: ending > branch > locked > premium > axis > beat", () => {
  assert.equal(
    labelNodeKind({ isEnding: true, isBranchPoint: true, premium: true, locked: true, axis: "pov" }),
    "ending",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: true, premium: true, locked: true, axis: "pov" }),
    "branch",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: false, premium: true, locked: true, axis: "pov" }),
    "locked",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: false, premium: true, locked: false, axis: "pov" }),
    "premium",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: false, premium: false, locked: false, axis: "pov" }),
    "pov",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: false, premium: false, locked: false, axis: "intensity" }),
    "intensity",
  );
  assert.equal(
    labelNodeKind({ isEnding: false, isBranchPoint: false, premium: false, locked: false, axis: null }),
    "beat",
  );
});

// ---- storygraph: canon validity ---------------------------------------------------------------------

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: "beat",
    episodeId: "e1",
    beatIndex: 0,
    role: "spine",
    isBranchPoint: false,
    isEnding: false,
    premium: false,
    locked: false,
    coinCost: 0,
    axis: null,
    ...over,
  };
}
function edge(from: string, to: string, isDefault = true, choice: string | null = null): GraphEdge {
  return { from, to, isDefault, choice };
}

test("checkCanon: a valid linear graph with one branch + default + ending passes", () => {
  const nodes = [
    node("a", { beatIndex: 0 }),
    node("b", { beatIndex: 1, kind: "branch", isBranchPoint: true }),
    node("c", { beatIndex: 2 }),
    node("z", { beatIndex: 3, kind: "ending", isEnding: true }),
  ];
  const edges = [
    edge("a", "b"),
    edge("b", "c", false, "choseC"),
    edge("b", "z"), // default fallback out of the branch
    edge("c", "z"),
  ];
  const r = checkCanon({ nodes, edges });
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.equal(r.issues.length, 0);
});

test("checkCanon: flags dangling edge, unreachable node, missing branch default, and no ending", () => {
  // a -> b (branch with only a guarded, dangling out-edge). orphan has an incoming edge from b only via a
  // cycle that is not reachable from the root: orphan <-> spur form an island with incoming edges on both,
  // so neither is a root and neither is reachable from a.
  const nodes = [
    node("a", { beatIndex: 0 }),
    node("b", { beatIndex: 1, kind: "branch", isBranchPoint: true }),
    node("orphan", { beatIndex: 2 }),
    node("spur", { beatIndex: 3 }),
  ];
  const edges = [
    edge("a", "b"),
    edge("b", "ghost", false, "guarded"), // dangling: ghost is not a node; also branch has no default
    edge("orphan", "spur"),
    edge("spur", "orphan"), // island cycle: both have incoming edges, unreachable from a
  ];
  const r = checkCanon({ nodes, edges });
  assert.equal(r.valid, false);
  const codes = r.issues.map((i) => i.code).sort();
  assert.ok(codes.includes("dangling_edge"));
  assert.ok(codes.includes("branch_missing_default"));
  assert.ok(codes.includes("no_ending"));
  assert.ok(codes.includes("unreachable_node"));
  const unreachRefs = r.issues.filter((i) => i.code === "unreachable_node").map((i) => i.ref).sort();
  assert.deepEqual(unreachRefs, ["orphan", "spur"]);
});

test("checkCanon: a branch with two default fallbacks is invalid", () => {
  const nodes = [
    node("b", { beatIndex: 0, kind: "branch", isBranchPoint: true }),
    node("z", { beatIndex: 1, kind: "ending", isEnding: true }),
    node("y", { beatIndex: 2, kind: "ending", isEnding: true }),
  ];
  const edges = [edge("b", "z"), edge("b", "y")]; // both default
  const r = checkCanon({ nodes, edges });
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === "branch_multiple_defaults" && i.ref === "b"));
});

test("checkCanon: empty graph is invalid with empty_graph", () => {
  const r = checkCanon({ nodes: [], edges: [] });
  assert.equal(r.valid, false);
  assert.deepEqual(r.issues.map((i) => i.code), ["empty_graph"]);
});

// ---- graph composition ------------------------------------------------------------------------------

test("edgeChoiceLabel: null/empty-object conditions are canon default (null), populated are labeled", () => {
  assert.equal(edgeChoiceLabel(null), null);
  assert.equal(edgeChoiceLabel({}), null);
  assert.equal(edgeChoiceLabel({ trust_gt: 5 }), "trust_gt");
  assert.equal(edgeChoiceLabel("flag_x"), "flag_x");
  assert.equal(edgeChoiceLabel(""), null);
});

test("axisOf only labels pov/intensity", () => {
  assert.equal(axisOf("pov"), "pov");
  assert.equal(axisOf("intensity"), "intensity");
  assert.equal(axisOf("dub"), null);
  assert.equal(axisOf(null), null);
});

test("composeSeriesGraph returns null when the series is absent (404 path)", () => {
  assert.equal(composeSeriesGraph("s1", [], [], [], []), null);
});

test("composeSeriesGraph labels nodes from flags, derives default edges, prices premium, runs canon", () => {
  const graph = composeSeriesGraph(
    "s1",
    [{ id: "s1" }],
    [
      { id: "a", episode_id: "e1", beat_index: 0, role: "spine", is_branch_point: false },
      { id: "b", episode_id: "e1", beat_index: 1, role: "spine", is_branch_point: true },
      { id: "z", episode_id: "e1", beat_index: 2, role: "ending", is_branch_point: false },
    ],
    [
      { beat_id: "a", any_premium: true, any_branch: false, any_ending: false, any_locked: false, min_premium_cost: 25, axis_kind: "pov" },
      { beat_id: "b", any_premium: false, any_branch: true, any_ending: false, any_locked: false, min_premium_cost: null, axis_kind: null },
      { beat_id: "z", any_premium: false, any_branch: false, any_ending: true, any_locked: false, min_premium_cost: null, axis_kind: null },
    ],
    [
      { from_beat_id: "a", to_beat_id: "b", condition: null },
      { from_beat_id: "b", to_beat_id: "z", condition: {} }, // default fallback
      { from_beat_id: "b", to_beat_id: "z", condition: { guard: true } }, // guarded; same target ok for test
    ],
  );
  assert.ok(graph);
  assert.equal(graph.seriesId, "s1");
  // a is premium-priced (not branch/ending) -> "premium" kind, coinCost 25, axis pov but premium wins.
  const a = graph.nodes.find((n) => n.id === "a");
  assert.equal(a?.kind, "premium");
  assert.equal(a?.coinCost, 25);
  // b is a branch; z is an ending.
  assert.equal(graph.nodes.find((n) => n.id === "b")?.kind, "branch");
  assert.equal(graph.nodes.find((n) => n.id === "z")?.kind, "ending");
  // edges: null/empty condition -> isDefault true; populated -> false with a choice label.
  const ab = graph.edges.find((e) => e.from === "a" && e.to === "b");
  assert.equal(ab?.isDefault, true);
  assert.equal(ab?.choice, null);
  const guarded = graph.edges.find((e) => e.from === "b" && e.choice === "guard");
  assert.equal(guarded?.isDefault, false);
  // pricing surfaces the premium node.
  assert.deepEqual(graph.pricing, [{ nodeId: "a", kind: "premium", coinCost: 25 }]);
  // memoryVars derived empty with a TODO (no hosted memory table).
  assert.deepEqual(graph.memoryVars, []);
  assert.ok(graph.memoryVarsTodo && graph.memoryVarsTodo.length > 0);
  // canon valid: branch b has exactly one default out-edge, reachable, has an ending.
  assert.equal(graph.canon.valid, true, JSON.stringify(graph.canon.issues));
});

test("graph builders target the content-graph tables and pass the seriesId param", () => {
  assert.match(buildSeriesExistsQuery("s1").text, /from series/);
  assert.match(buildGraphBeatsQuery("s1").text, /from beats/);
  const flags = buildGraphVariantFlagsQuery("s1");
  assert.match(flags.text, /beat_variants/);
  assert.match(flags.text, /entitlement_scope/);
  const edges = buildGraphEdgesQuery("s1");
  assert.match(edges.text, /beat_edges/);
  // both edge endpoints constrained to the series so cross-series edges are not returned.
  assert.match(edges.text, /bf\.series_id = \$1/);
  assert.match(edges.text, /bt\.series_id = \$1/);
  assert.deepEqual(edges.values, ["s1"]);
});

// ---- band math --------------------------------------------------------------------------------------

test("bands: a sparse arm yields a wide, zero-straddling (inconclusive) lift band, never a point", () => {
  const v = liftBand(2, 3, 1, 3); // tiny samples
  assert.equal(v.inconclusive, true);
  assert.equal(v.direction, "none");
  assert.ok(v.band.low < v.band.center && v.band.center < v.band.high, "band must have width, not a point");
  assert.ok(v.band.low <= 0 && v.band.high >= 0, "sparse band straddles zero");
});

test("bands: a large decisive sample yields a tight band with a direction", () => {
  const v = liftBand(8000, 10000, 5000, 10000); // 0.8 vs 0.5
  assert.equal(v.inconclusive, false);
  assert.equal(v.direction, "up");
  assert.ok(Math.abs(v.band.center - 0.3) < 1e-9);
  assert.ok(v.band.high - v.band.low < 0.05, "large-n band is tight");
});

test("bands: rateBand with zero trials is no-evidence [0,1]@0; bandFromMargin clamps bad input", () => {
  assert.deepEqual(rateBand(0, 0), { low: 0, high: 1, center: 0 });
  assert.deepEqual(bandFromMargin(0.5, -1), { low: 0.5, high: 0.5, center: 0.5 });
  assert.deepEqual(bandFromMargin(NaN, NaN), { low: 0, high: 0, center: 0 });
});

// ---- analytics: beat retention ----------------------------------------------------------------------

test("buildBeatRetentionQuery counts beat_started vs beat_skipped from engagement_events", () => {
  const spec = buildBeatRetentionQuery("s1");
  assert.match(spec.text, /from engagement_events/);
  assert.match(spec.text, /beat_started/);
  assert.match(spec.text, /beat_skipped/);
  assert.deepEqual(spec.values, ["s1"]);
});

test("mapBeatRetention derives a 0..1 retention, with started=0 -> 0 (no NaN)", () => {
  const rows = mapBeatRetention([
    { beat_id: "b1", started: 100, skipped: 20 },
    { beat_id: "b2", started: 0, skipped: 0 },
    { beat_id: "b3", started: 10, skipped: 50 }, // more skips than starts -> clamp to 0
  ]);
  assert.deepEqual(rows[0], { beatId: "b1", retention: 0.8, started: 100, skipped: 20 });
  assert.deepEqual(rows[1], { beatId: "b2", retention: 0, started: 0, skipped: 0 });
  assert.equal(rows[2].retention, 0);
});

// ---- analytics: branch performance (lift as a BAND) -------------------------------------------------

test("buildBranchPerformanceQuery reads decision_log joined to the series beats", () => {
  const spec = buildBranchPerformanceQuery("s1");
  assert.match(spec.text, /from decision_log/);
  assert.match(spec.text, /join beats b on b\.id = d\.beat_id/);
  assert.match(spec.text, /b\.series_id = \$1/);
  assert.deepEqual(spec.values, ["s1"]);
});

test("mapBranchPerformance returns a lift BAND per branch, never a bare point, with verdict", () => {
  const rows = mapBranchPerformance([
    { beat_id: "b1", treatment_trials: 10000, treatment_success: 8000, control_trials: 10000, control_success: 5000 },
    { beat_id: "b2", treatment_trials: 3, treatment_success: 2, control_trials: 3, control_success: 1 },
  ]);
  // Every row carries a band object with low/high/center; b1 is decisive up, b2 inconclusive.
  for (const r of rows) {
    assert.ok(typeof r.lift.low === "number" && typeof r.lift.high === "number" && typeof r.lift.center === "number");
    assert.ok(r.lift.low <= r.lift.center && r.lift.center <= r.lift.high);
  }
  assert.equal(rows[0].branchId, "b1");
  assert.equal(rows[0].inconclusive, false);
  assert.equal(rows[0].direction, "up");
  assert.equal(rows[1].inconclusive, true);
  assert.equal(rows[1].direction, "none");
});

// ---- analytics: ending distribution -----------------------------------------------------------------

test("buildEndingDistributionQuery counts episode_completed on ending beats only", () => {
  const spec = buildEndingDistributionQuery("s1");
  assert.match(spec.text, /episode_completed/);
  assert.match(spec.text, /role = 'ending'/);
  assert.match(spec.text, /is_ending/);
});

test("mapEndingDistribution turns counts into shares summing to ~1", () => {
  const rows = mapEndingDistribution([
    { beat_id: "z1", completions: 75 },
    { beat_id: "z2", completions: 25 },
  ]);
  assert.equal(rows[0].share, 0.75);
  assert.equal(rows[1].share, 0.25);
  assert.equal(mapEndingDistribution([]).length, 0);
  // zero total -> shares are 0, not NaN.
  assert.equal(mapEndingDistribution([{ beat_id: "z", completions: 0 }])[0].share, 0);
});

// ---- analytics: funnel / completion / cohort --------------------------------------------------------

test("deriveSeriesFunnel produces ordered stages with prior-stage conversion (entry rate 1)", () => {
  const stages = deriveSeriesFunnel({
    impression: 1000,
    play: 500,
    completion_50: 250,
    episode_completed: 100,
    unlock_purchased: 10,
  });
  assert.deepEqual(stages.map((s) => s.stage), [...SERIES_FUNNEL_STAGES]);
  assert.equal(stages[0].conversionFromPrev, 1);
  assert.equal(stages[1].conversionFromPrev, 0.5);
  assert.equal(stages[2].conversionFromPrev, 0.5);
});

test("deriveSeriesFunnel: a zero prior stage gives 0 conversion, not NaN", () => {
  const stages = deriveSeriesFunnel({ impression: 0, play: 0, completion_50: 5 });
  assert.equal(stages[1].conversionFromPrev, 0);
  assert.equal(stages[2].conversionFromPrev, 0);
});

test("buildSeriesFunnelQuery / Completion / Cohort read engagement_events for the series", () => {
  assert.match(buildSeriesFunnelQuery("s1").text, /from engagement_events/);
  assert.match(buildSeriesCompletionQuery("s1").text, /from engagement_events/);
  const cohort = buildCohortFunnelQuery("s1");
  assert.match(cohort.text, /viewer_state/);
  assert.match(cohort.text, /cohort_id/);
  assert.deepEqual(cohort.values, ["s1"]);
});

test("mapCompletion derives completion=completion_50/play and total watch ms (null-safe)", () => {
  assert.deepEqual(mapCompletion([{ plays: 200, completions: 50, watch_ms: 123456 }]), {
    completion: 0.25,
    watchTimeMs: 123456,
  });
  assert.deepEqual(mapCompletion([]), { completion: 0, watchTimeMs: 0 });
  assert.deepEqual(mapCompletion([{ plays: 0, completions: 0, watch_ms: null }]), {
    completion: 0,
    watchTimeMs: 0,
  });
});

test("mapCohortSlices derives per-cohort completion with unassigned bucket", () => {
  const rows = mapCohortSlices([
    { cohort_id: "earlybird", play: 100, completion_50: 40, episode_completed: 10 },
    { cohort_id: "unassigned", play: 0, completion_50: 0, episode_completed: 0 },
  ]);
  assert.deepEqual(rows[0], {
    cohortId: "earlybird",
    play: 100,
    completion50: 40,
    episodeCompleted: 10,
    completion: 0.4,
  });
  assert.equal(rows[1].completion, 0);
});

// ---- end-to-end builder round-trip through the fake pg ---------------------------------------------

test("graph builders round-trip unchanged through the fake pg query()", async () => {
  const { db, calls } = fakePg([[{ id: "s1" }]]);
  const spec = buildSeriesExistsQuery("s1");
  const r = await db.query(spec.text, spec.values);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, spec.text);
  assert.deepEqual(calls[0].values, ["s1"]);
  assert.equal(r.rows[0].id, "s1");
});
