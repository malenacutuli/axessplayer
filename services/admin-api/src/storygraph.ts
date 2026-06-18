// Pure story-graph domain for the admin API sections 4-6. This module holds NO database access and NO
// HTTP: it is the constraint solver (validate), the deterministic journey walker (simulate), and the
// accessibility readiness scorer, all as pure functions over plain data. The aggregation layer
// (aggregate.ts) reads the hosted content graph and hands these functions plain rows; the HTTP layer
// (http/app.ts) calls validate/simulate on a graph it already composed. Keeping the solver pure is what
// makes it unit-testable with node:test and free of a live Postgres. No em dashes.
//
// The graph shape mirrors the ADMIN API contract for GET /admin/story-graph/:seriesId:
//   { seriesId, version, nodes:[{id, kind, ...}], edges:[{from,to,...}], memoryVars, pricing }
// A node's `kind` is labeled from the hosted flags: a branch point, an ending, a premium-locked beat, a
// pov/intensity variant axis, or a plain beat. memoryVars are read from the graph data when present and
// otherwise derived empty (with a TODO), never fabricated. pricing carries per-branch/ending coin_cost.

// ---- Node + edge model ------------------------------------------------------------------------------

// The canonical node kinds the console renders. `beat` is the default spine node; the others are labeled
// from the hosted flags (is_branch_point, is_ending, is_premium) and the variant axis (pov/intensity).
export type NodeKind = "beat" | "branch" | "ending" | "pov" | "intensity" | "premium" | "locked";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  episodeId: string;
  beatIndex: number;
  // The narrative role from beats.role (spine|hero|variant|connective|ending|cold_open).
  role: string;
  isBranchPoint: boolean;
  isEnding: boolean;
  // True when any variant on this beat is premium/locked (a paid unlock gates the node).
  locked: boolean;
  // The coin price to traverse into this node, when it is premium-gated (else 0).
  coinCost: number;
  // The variant axis present on the beat, if any (pov|intensity|...): used to label pov/intensity nodes.
  axis: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  // True for the canon/default fallback edge out of a branch point. A valid branch must have exactly one.
  isDefault: boolean;
  // An opaque condition label (from beat_edges.condition or variant branch_conditions). Display-only.
  condition: string | null;
}

export interface MemoryVar {
  name: string;
  // The declared type if known; "unknown" when only the name was observed.
  type: "boolean" | "number" | "string" | "unknown";
  // Where the variable was seen (a node id or edge condition), for operator traceability.
  source: string;
}

export interface StoryGraph {
  seriesId: string;
  // A content-addressed-ish version stamp. Deterministic over the node/edge set so the console can detect
  // a graph change without a server-side version column (which does not exist yet).
  version: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  memoryVars: MemoryVar[];
  // Per-branch and per-ending pricing, surfaced separately so the console can render a pricing panel
  // without walking the node list. Empty when nothing is premium-gated.
  pricing: Array<{ nodeId: string; kind: NodeKind; coinCost: number }>;
  // Set when memoryVars could not be read from a real story-graph source and were derived empty. The
  // console shows a "memory variables not yet modeled" note rather than implying the story has none.
  memoryVarsTodo?: string;
}

// Label a beat node from its flags. Precedence: ending > branch > premium/locked > axis (pov/intensity) >
// plain beat. Precedence is deliberate: an ending that is also a branch point is rendered as an ending
// (the terminal nature dominates the console's layout).
export function labelNodeKind(input: {
  isEnding: boolean;
  isBranchPoint: boolean;
  locked: boolean;
  axis: string | null;
}): NodeKind {
  if (input.isEnding) return "ending";
  if (input.isBranchPoint) return "branch";
  if (input.locked) return "premium";
  if (input.axis === "pov") return "pov";
  if (input.axis === "intensity") return "intensity";
  return "beat";
}

// A small deterministic stamp over the graph topology. Not cryptographic: a stable fingerprint so the
// console can tell two reads apart and cache. Sorted so input ordering does not change the version.
export function graphVersion(nodes: GraphNode[], edges: GraphEdge[]): string {
  const n = nodes.map((x) => `${x.id}:${x.kind}`).sort().join("|");
  const e = edges.map((x) => `${x.from}>${x.to}`).sort().join("|");
  let h = 5381;
  const s = `${n}#${e}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Unsigned hex, plus the counts so a human can sanity-check the size at a glance.
  return `g${(h >>> 0).toString(16)}.n${nodes.length}.e${edges.length}`;
}

// ---- Constraint solver: validate -------------------------------------------------------------------
//
// Ports the spirit of the prompt-02 constraint solver as a pure canon/broken-link check. The checks:
//   1. Reachability: every node is reachable from a root (a node with no incoming edge). An unreachable
//      node is an orphan an operator must wire up or delete.
//   2. No dangling edges: every edge endpoint references a real node.
//   3. Branch default fallback: every branch node has exactly one default-fallback out-edge, so the
//      engine always has a canon path when no condition matches.
//   4. At least one ending: a finished graph must terminate somewhere.

export type IssueCode =
  | "dangling_edge"
  | "unreachable_node"
  | "branch_missing_default"
  | "branch_multiple_defaults"
  | "no_ending"
  | "empty_graph";

export interface ValidationIssue {
  code: IssueCode;
  // The offending node/edge id(s), for the console to highlight. Stable, machine-readable.
  ref: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateStoryGraph(graph: Pick<StoryGraph, "nodes" | "edges">): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  if (graph.nodes.length === 0) {
    issues.push({ code: "empty_graph", ref: "", message: "graph has no nodes" });
    return { valid: false, issues };
  }

  // 2. Dangling edges. Collect only the well-formed edges for the reachability pass below.
  const liveEdges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const fromOk = nodeIds.has(e.from);
    const toOk = nodeIds.has(e.to);
    if (!fromOk || !toOk) {
      const bad = !fromOk ? e.from : e.to;
      issues.push({ code: "dangling_edge", ref: `${e.from}>${e.to}`, message: `edge references unknown node ${bad}` });
      continue;
    }
    liveEdges.push(e);
  }

  // 3. Branch default fallback. Each branch node needs exactly one default out-edge.
  const outByNode = new Map<string, GraphEdge[]>();
  for (const e of liveEdges) {
    const list = outByNode.get(e.from) ?? [];
    list.push(e);
    outByNode.set(e.from, list);
  }
  for (const n of graph.nodes) {
    if (n.kind !== "branch" && !n.isBranchPoint) continue;
    const outs = outByNode.get(n.id) ?? [];
    const defaults = outs.filter((o) => o.isDefault);
    if (defaults.length === 0) {
      issues.push({ code: "branch_missing_default", ref: n.id, message: `branch ${n.id} has no default fallback edge` });
    } else if (defaults.length > 1) {
      issues.push({ code: "branch_multiple_defaults", ref: n.id, message: `branch ${n.id} has ${defaults.length} default fallback edges` });
    }
  }

  // 4. At least one ending.
  if (!graph.nodes.some((n) => n.kind === "ending" || n.isEnding)) {
    issues.push({ code: "no_ending", ref: "", message: "graph has no ending node" });
  }

  // 1. Reachability. Roots are nodes with no incoming live edge; if the whole graph has incoming edges on
  // every node (a cycle with no entry), fall back to the lowest beatIndex node as the root so the check
  // is well-defined rather than reporting everything unreachable.
  const hasIncoming = new Set(liveEdges.map((e) => e.to));
  let roots = graph.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
  if (roots.length === 0) {
    const first = [...graph.nodes].sort((a, b) => a.beatIndex - b.beatIndex)[0];
    roots = [first.id];
  }
  const reachable = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const e of outByNode.get(cur) ?? []) stack.push(e.to);
  }
  for (const n of graph.nodes) {
    if (!reachable.has(n.id)) {
      issues.push({ code: "unreachable_node", ref: n.id, message: `node ${n.id} is unreachable from any root` });
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---- Deterministic journey walker: simulate --------------------------------------------------------
//
// Walk the graph from a root applying the operator-supplied choices, returning the visited node sequence.
// Two input modes:
//   - path: an explicit list of node ids to step through. Each hop must be a real out-edge; an illegal
//     hop stops the walk and is reported.
//   - signals: a map of condition labels the walker matches against out-edge conditions; when no
//     condition matches, it takes the default fallback edge. This is the engine's canon behavior.
// The walk is deterministic: same graph + same input always yields the same sequence. It is bounded by
// the node count to guarantee termination even on a cyclic graph.

export interface SimulateInput {
  // Explicit node-id path to replay. Mutually exclusive with `signals`; `path` wins if both are present.
  path?: string[];
  // Condition labels that are "true" for this journey. The walker prefers an out-edge whose condition is
  // in this set, else the default fallback.
  signals?: string[];
  // Optional explicit start node. Defaults to the first root (no incoming edge), else lowest beatIndex.
  start?: string;
}

export interface SimulateStep {
  nodeId: string;
  kind: NodeKind;
  // Why the walker arrived here: the start, a matched signal, a default fallback, or an explicit path hop.
  via: "start" | "signal" | "default" | "path";
}

export interface SimulateResult {
  visited: SimulateStep[];
  // True when the walk ended at an ending node; false when it stopped early (no out-edge, illegal hop, or
  // the bound was hit). `stoppedReason` explains a non-ending stop.
  reachedEnding: boolean;
  stoppedReason: "ending" | "no_out_edge" | "illegal_hop" | "bound_reached" | "empty_graph" | "bad_start";
}

function pickStart(graph: Pick<StoryGraph, "nodes" | "edges">, requested?: string): string | null {
  if (graph.nodes.length === 0) return null;
  if (requested != null) {
    return graph.nodes.some((n) => n.id === requested) ? requested : null;
  }
  const hasIncoming = new Set(graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.to)).map((e) => e.to));
  const root = graph.nodes.find((n) => !hasIncoming.has(n.id));
  if (root != null) return root.id;
  return [...graph.nodes].sort((a, b) => a.beatIndex - b.beatIndex)[0].id;
}

export function simulateStoryGraph(
  graph: Pick<StoryGraph, "nodes" | "edges">,
  input: SimulateInput,
): SimulateResult {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  if (graph.nodes.length === 0) {
    return { visited: [], reachedEnding: false, stoppedReason: "empty_graph" };
  }

  const outByNode = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    const list = outByNode.get(e.from) ?? [];
    list.push(e);
    outByNode.set(e.from, list);
  }

  // Mode A: explicit path. Validate each hop is a real out-edge.
  if (input.path != null && input.path.length > 0) {
    const visited: SimulateStep[] = [];
    const path = input.path;
    const first = nodeById.get(path[0]);
    if (first == null) return { visited, reachedEnding: false, stoppedReason: "bad_start" };
    visited.push({ nodeId: first.id, kind: first.kind, via: "start" });
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const next = path[i];
      const legal = (outByNode.get(prev) ?? []).some((e) => e.to === next);
      const node = nodeById.get(next);
      if (!legal || node == null) {
        return { visited, reachedEnding: false, stoppedReason: "illegal_hop" };
      }
      visited.push({ nodeId: node.id, kind: node.kind, via: "path" });
    }
    const last = visited[visited.length - 1];
    const lastNode = nodeById.get(last.nodeId) as GraphNode;
    return {
      visited,
      reachedEnding: lastNode.kind === "ending" || lastNode.isEnding,
      stoppedReason: lastNode.kind === "ending" || lastNode.isEnding ? "ending" : "no_out_edge",
    };
  }

  // Mode B: signal-driven walk from a start node.
  const startId = pickStart(graph, input.start);
  if (startId == null) return { visited: [], reachedEnding: false, stoppedReason: "bad_start" };
  const signals = new Set(input.signals ?? []);
  const visited: SimulateStep[] = [];
  let cur = startId;
  let via: SimulateStep["via"] = "start";
  const bound = graph.nodes.length + 1;

  for (let steps = 0; steps <= bound; steps++) {
    const node = nodeById.get(cur) as GraphNode;
    visited.push({ nodeId: node.id, kind: node.kind, via });
    if (node.kind === "ending" || node.isEnding) {
      return { visited, reachedEnding: true, stoppedReason: "ending" };
    }
    const outs = outByNode.get(cur) ?? [];
    if (outs.length === 0) {
      return { visited, reachedEnding: false, stoppedReason: "no_out_edge" };
    }
    // Prefer a matched-signal edge (deterministic: the FIRST out-edge whose condition is a signal),
    // else the default fallback, else the first out-edge so the walk always progresses.
    const matched = outs.find((e) => e.condition != null && signals.has(e.condition));
    if (matched != null) {
      cur = matched.to;
      via = "signal";
      continue;
    }
    const def = outs.find((e) => e.isDefault);
    if (def != null) {
      cur = def.to;
      via = "default";
      continue;
    }
    cur = outs[0].to;
    via = "default";
  }

  return { visited, reachedEnding: false, stoppedReason: "bound_reached" };
}

// ---- Accessibility readiness scorer ----------------------------------------------------------------
//
// Compute a per-series readiness score from the presence of the four accessibility tracks across the
// series' variants: captions (cc), audio description (ad), sign, and dub. The score is the mean coverage
// over the four tracks, 0..100. A track below full coverage is a blocker entry naming the gap.

export interface TrackCoverage {
  total: number;
  withCaptions: number;
  withAudioDescription: number;
  withSign: number;
  withDub: number;
}

export interface ReadinessBlocker {
  track: "cc" | "ad" | "sign" | "dub";
  // How many variants are missing this track.
  missing: number;
  message: string;
}

export interface SeriesReadiness {
  seriesId: string;
  title: string | null;
  // 0..100 mean coverage across the four tracks. 100 when every variant has every track.
  score: number;
  blockers: ReadinessBlocker[];
}

export function scoreReadiness(seriesId: string, title: string | null, cov: TrackCoverage): SeriesReadiness {
  const total = cov.total;
  if (total === 0) {
    return {
      seriesId,
      title,
      score: 0,
      blockers: [{ track: "cc", missing: 0, message: "series has no variants to assess" }],
    };
  }
  const tracks: Array<{ track: ReadinessBlocker["track"]; have: number }> = [
    { track: "cc", have: cov.withCaptions },
    { track: "ad", have: cov.withAudioDescription },
    { track: "sign", have: cov.withSign },
    { track: "dub", have: cov.withDub },
  ];
  let sum = 0;
  const blockers: ReadinessBlocker[] = [];
  for (const t of tracks) {
    const pct = (t.have / total) * 100;
    sum += pct;
    const missing = total - t.have;
    if (missing > 0) {
      blockers.push({ track: t.track, missing, message: `${missing} of ${total} variants missing ${t.track}` });
    }
  }
  // Mean over the four tracks, rounded to a whole percent. Deterministic and bounded 0..100.
  const score = Math.round(sum / tracks.length);
  return { seriesId, title, score, blockers };
}
