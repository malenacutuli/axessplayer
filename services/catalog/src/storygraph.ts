// Pure branch-editor graph domain for the catalog creator surface (GET /series/:id/graph). This module
// holds NO database access and NO HTTP: it is the node-kind labeler and the canon validity solver, both as
// pure functions over plain data. queries.ts reads the hosted content graph and hands these functions plain
// rows; server.ts calls the validator on a graph it already composed. Keeping the solver pure is what makes
// it unit-testable with node:test against a fake pg.
//
// The validation logic is COPIED in spirit from services/admin-api/src/storygraph.ts (reachability + no
// dangling edges + every branch has a default fallback). We copy the pure logic rather than importing
// admin-api: catalog is its own deployable and must not depend on the admin service. No em dashes.

// The node kinds the branch editor renders. `beat` is the default spine node; the others are labeled from
// the hosted flags (is_branch_point, is_ending, is_premium) and the variant axis (pov/intensity). `locked`
// is a premium node that is also gated by an entitlement scope the viewer must own.
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
  // True when any variant on this beat is premium (a paid unlock gates the node).
  premium: boolean;
  // True when the premium node also carries an entitlement scope (a hard lock, not just a price tag).
  locked: boolean;
  // The coin price to traverse into this node, when it is premium-gated (else 0). Creator-set.
  coinCost: number;
  // The variant axis present on the beat, if any (pov|intensity): used to label pov/intensity nodes.
  axis: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  // The choice label an operator/viewer takes to traverse this edge (from beat_edges.condition).
  choice: string | null;
  // True for the canon/default fallback edge out of a branch point (empty/null condition). A valid branch
  // must have exactly one.
  isDefault: boolean;
}

export interface MemoryVar {
  name: string;
  type: "boolean" | "number" | "string" | "unknown";
  source: string;
}

export interface CanonResult {
  valid: boolean;
  issues: CanonIssue[];
}

export type CanonIssueCode =
  | "empty_graph"
  | "dangling_edge"
  | "unreachable_node"
  | "branch_missing_default"
  | "branch_multiple_defaults"
  | "no_ending";

export interface CanonIssue {
  code: CanonIssueCode;
  // The offending node/edge id(s), for the editor to highlight. Stable, machine-readable.
  ref: string;
  message: string;
}

// Label a beat node from its flags. Precedence: ending > branch > locked > premium > axis (pov/intensity) >
// plain beat. The terminal/branch nature dominates the editor layout; a locked beat (hard entitlement) is
// shown as locked over a merely premium-priced one.
export function labelNodeKind(input: {
  isEnding: boolean;
  isBranchPoint: boolean;
  premium: boolean;
  locked: boolean;
  axis: string | null;
}): NodeKind {
  if (input.isEnding) return "ending";
  if (input.isBranchPoint) return "branch";
  if (input.locked) return "locked";
  if (input.premium) return "premium";
  if (input.axis === "pov") return "pov";
  if (input.axis === "intensity") return "intensity";
  return "beat";
}

// Canon validity check. COPIED from the admin-api validation spirit:
//   1. Reachability: every node reachable from a root (a node with no incoming edge); if a cycle has no
//      entry, the lowest-beatIndex node is the fallback root so the check is well-defined.
//   2. No dangling edges: every edge endpoint references a real node.
//   3. Branch default fallback: every branch node has exactly one default-fallback out-edge.
//   4. At least one ending: a finished graph must terminate somewhere.
export function checkCanon(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): CanonResult {
  const issues: CanonIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  if (graph.nodes.length === 0) {
    issues.push({ code: "empty_graph", ref: "", message: "graph has no nodes" });
    return { valid: false, issues };
  }

  // 2. Dangling edges. Keep only the well-formed edges for the reachability + branch passes below.
  const liveEdges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const fromOk = nodeIds.has(e.from);
    const toOk = nodeIds.has(e.to);
    if (!fromOk || !toOk) {
      const bad = !fromOk ? e.from : e.to;
      issues.push({
        code: "dangling_edge",
        ref: `${e.from}>${e.to}`,
        message: `edge references unknown node ${bad}`,
      });
      continue;
    }
    liveEdges.push(e);
  }

  // Index out-edges per node for the branch + reachability passes.
  const outByNode = new Map<string, GraphEdge[]>();
  for (const e of liveEdges) {
    const list = outByNode.get(e.from) ?? [];
    list.push(e);
    outByNode.set(e.from, list);
  }

  // 3. Branch default fallback. Each branch node needs exactly one default out-edge.
  for (const n of graph.nodes) {
    if (n.kind !== "branch" && !n.isBranchPoint) continue;
    const outs = outByNode.get(n.id) ?? [];
    const defaults = outs.filter((o) => o.isDefault);
    if (defaults.length === 0) {
      issues.push({
        code: "branch_missing_default",
        ref: n.id,
        message: `branch ${n.id} has no default fallback edge`,
      });
    } else if (defaults.length > 1) {
      issues.push({
        code: "branch_multiple_defaults",
        ref: n.id,
        message: `branch ${n.id} has ${defaults.length} default fallback edges`,
      });
    }
  }

  // 4. At least one ending.
  if (!graph.nodes.some((n) => n.kind === "ending" || n.isEnding)) {
    issues.push({ code: "no_ending", ref: "", message: "graph has no ending node" });
  }

  // 1. Reachability. Roots are nodes with no incoming live edge; fall back to the lowest-beatIndex node
  // when every node has an incoming edge (a cycle with no entry) so the check is well-defined.
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
      issues.push({
        code: "unreachable_node",
        ref: n.id,
        message: `node ${n.id} is unreachable from any root`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
