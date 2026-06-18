// Pure story-graph domain tests: the constraint solver (validate) flags a broken graph and passes a valid
// one, the journey walker (simulate) is deterministic over the same graph + input, and the accessibility
// readiness scorer produces the expected 0..100 score and blocker list. No DB, no HTTP. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  labelNodeKind,
  validateStoryGraph,
  simulateStoryGraph,
  scoreReadiness,
  type GraphNode,
  type GraphEdge,
} from "./storygraph.js";

// Build a node with sensible defaults so tests only specify what matters.
function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: "beat",
    episodeId: "e1",
    beatIndex: 0,
    role: "spine",
    isBranchPoint: false,
    isEnding: false,
    locked: false,
    coinCost: 0,
    axis: null,
    ...over,
  };
}
function edge(from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return { from, to, isDefault: true, condition: null, ...over };
}

// ---- labelNodeKind ----------------------------------------------------------------------------------

test("labelNodeKind precedence: ending > branch > premium > axis > beat", () => {
  assert.equal(labelNodeKind({ isEnding: true, isBranchPoint: true, locked: true, axis: "pov" }), "ending");
  assert.equal(labelNodeKind({ isEnding: false, isBranchPoint: true, locked: true, axis: "pov" }), "branch");
  assert.equal(labelNodeKind({ isEnding: false, isBranchPoint: false, locked: true, axis: "pov" }), "premium");
  assert.equal(labelNodeKind({ isEnding: false, isBranchPoint: false, locked: false, axis: "pov" }), "pov");
  assert.equal(labelNodeKind({ isEnding: false, isBranchPoint: false, locked: false, axis: "intensity" }), "intensity");
  assert.equal(labelNodeKind({ isEnding: false, isBranchPoint: false, locked: false, axis: null }), "beat");
});

// ---- validate: a valid graph passes -----------------------------------------------------------------

test("validateStoryGraph passes a reachable graph with a branch default and an ending", () => {
  const nodes = [
    node("a", { beatIndex: 0 }),
    node("b", { beatIndex: 1, kind: "branch", isBranchPoint: true }),
    node("c", { beatIndex: 2 }),
    node("d", { beatIndex: 3, kind: "ending", isEnding: true }),
  ];
  const edges = [
    edge("a", "b"),
    // branch b: one signal edge + one default fallback
    edge("b", "c", { isDefault: false, condition: "chose_left" }),
    edge("b", "d", { isDefault: true }),
    edge("c", "d"),
  ];
  const r = validateStoryGraph({ nodes, edges });
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.equal(r.issues.length, 0);
});

// ---- validate: a broken graph fails on every check --------------------------------------------------

test("validateStoryGraph flags dangling edge, unreachable node, missing branch default, and no ending", () => {
  const nodes = [
    node("a", { beatIndex: 0 }),
    node("b", { beatIndex: 1, kind: "branch", isBranchPoint: true }),
    node("orphan", { beatIndex: 9 }), // unreachable: no incoming edge and not a root target
  ];
  const edges = [
    edge("a", "b"),
    edge("b", "ghost", { isDefault: false, condition: "x" }), // dangling: ghost is not a node
    // b is a branch with no default fallback (the only out-edge is conditional and dangling)
  ];
  const r = validateStoryGraph({ nodes, edges });
  assert.equal(r.valid, false);
  const codes = new Set(r.issues.map((i) => i.code));
  assert.ok(codes.has("dangling_edge"), "dangling_edge");
  assert.ok(codes.has("branch_missing_default"), "branch_missing_default");
  assert.ok(codes.has("no_ending"), "no_ending");
  // orphan has no incoming edge so it is itself a root and thus reachable; but "b" routes only to a
  // dangling node, and nothing makes "orphan" unreachable. Assert the unreachable check is wired by a
  // dedicated case below.
});

test("validateStoryGraph flags an unreachable node behind no path", () => {
  const nodes = [
    node("a", { beatIndex: 0 }),
    node("b", { beatIndex: 1, kind: "ending", isEnding: true }),
    node("island", { beatIndex: 2 }),
  ];
  // a -> b is the only path; island has an incoming edge from b? No: island is fed only by a self-less
  // edge that does not originate from a reachable root. Make island reachable ONLY from itself.
  const edges = [edge("a", "b"), edge("island", "island")];
  const r = validateStoryGraph({ nodes, edges });
  // island has an incoming edge (from itself), so it is not a root; a/b are the roots; island is
  // unreachable from them.
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes("unreachable_node"), JSON.stringify(r.issues));
});

test("validateStoryGraph reports empty_graph for no nodes", () => {
  const r = validateStoryGraph({ nodes: [], edges: [] });
  assert.equal(r.valid, false);
  assert.deepEqual(r.issues.map((i) => i.code), ["empty_graph"]);
});

test("validateStoryGraph flags a branch with multiple defaults", () => {
  const nodes = [
    node("a", { beatIndex: 0, kind: "branch", isBranchPoint: true }),
    node("b", { beatIndex: 1, kind: "ending", isEnding: true }),
    node("c", { beatIndex: 2, kind: "ending", isEnding: true }),
  ];
  const edges = [edge("a", "b", { isDefault: true }), edge("a", "c", { isDefault: true })];
  const r = validateStoryGraph({ nodes, edges });
  assert.ok(r.issues.some((i) => i.code === "branch_multiple_defaults"));
});

// ---- simulate: determinism ------------------------------------------------------------------------

const walkNodes = [
  node("a", { beatIndex: 0 }),
  node("b", { beatIndex: 1, kind: "branch", isBranchPoint: true }),
  node("left", { beatIndex: 2 }),
  node("right", { beatIndex: 3 }),
  node("end", { beatIndex: 4, kind: "ending", isEnding: true }),
];
const walkEdges = [
  edge("a", "b"),
  edge("b", "left", { isDefault: false, condition: "go_left" }),
  edge("b", "right", { isDefault: true }),
  edge("left", "end"),
  edge("right", "end"),
];

test("simulateStoryGraph signal walk is deterministic and follows matched signals", () => {
  const first = simulateStoryGraph({ nodes: walkNodes, edges: walkEdges }, { signals: ["go_left"] });
  const second = simulateStoryGraph({ nodes: walkNodes, edges: walkEdges }, { signals: ["go_left"] });
  assert.deepEqual(first, second, "same input -> same output");
  assert.equal(first.reachedEnding, true);
  assert.deepEqual(first.visited.map((s) => s.nodeId), ["a", "b", "left", "end"]);
  assert.equal(first.visited[2].via, "signal");
});

test("simulateStoryGraph takes the default fallback when no signal matches", () => {
  const r = simulateStoryGraph({ nodes: walkNodes, edges: walkEdges }, { signals: [] });
  assert.equal(r.reachedEnding, true);
  assert.deepEqual(r.visited.map((s) => s.nodeId), ["a", "b", "right", "end"]);
  assert.equal(r.visited[2].via, "default");
});

test("simulateStoryGraph explicit path replays legal hops and rejects an illegal one", () => {
  const ok = simulateStoryGraph({ nodes: walkNodes, edges: walkEdges }, { path: ["a", "b", "left", "end"] });
  assert.equal(ok.reachedEnding, true);
  assert.deepEqual(ok.visited.map((s) => s.nodeId), ["a", "b", "left", "end"]);

  const bad = simulateStoryGraph({ nodes: walkNodes, edges: walkEdges }, { path: ["a", "left"] });
  assert.equal(bad.stoppedReason, "illegal_hop");
  assert.equal(bad.reachedEnding, false);
});

test("simulateStoryGraph terminates on a cyclic graph (bounded walk)", () => {
  const nodes = [node("x", { beatIndex: 0 }), node("y", { beatIndex: 1 })];
  const edges = [edge("x", "y"), edge("y", "x")];
  const r = simulateStoryGraph({ nodes, edges }, { signals: [] });
  assert.equal(r.stoppedReason, "bound_reached");
  assert.equal(r.reachedEnding, false);
});

// ---- readiness scoring ----------------------------------------------------------------------------

test("scoreReadiness computes mean track coverage and lists blockers", () => {
  // 10 variants: 10 cc, 5 ad, 0 sign, 0 dub -> (100 + 50 + 0 + 0)/4 = 37.5 -> 38
  const r = scoreReadiness("s1", "Series One", {
    total: 10,
    withCaptions: 10,
    withAudioDescription: 5,
    withSign: 0,
    withDub: 0,
  });
  assert.equal(r.score, 38);
  const byTrack = Object.fromEntries(r.blockers.map((b) => [b.track, b.missing]));
  assert.equal(byTrack.ad, 5);
  assert.equal(byTrack.sign, 10);
  assert.equal(byTrack.dub, 10);
  assert.equal(byTrack.cc, undefined, "cc fully covered, no blocker");
});

test("scoreReadiness is 100 with full coverage and 0 with no variants", () => {
  const full = scoreReadiness("s2", "T", { total: 4, withCaptions: 4, withAudioDescription: 4, withSign: 4, withDub: 4 });
  assert.equal(full.score, 100);
  assert.equal(full.blockers.length, 0);

  const none = scoreReadiness("s3", null, { total: 0, withCaptions: 0, withAudioDescription: 0, withSign: 0, withDub: 0 });
  assert.equal(none.score, 0);
  assert.equal(none.blockers.length, 1);
});
