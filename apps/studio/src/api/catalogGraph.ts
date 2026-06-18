// Pure helpers over the catalog graph view: broken-link detection, the publish-readiness verdict (canon +
// links), the Simple-mode linear timeline derivation, and the column/row layout for the Pro SVG diagram.
// All dependency-free so they are unit-testable and the browser bundle pulls no graph library. No em dashes.

import type { GraphNode, GraphEdge, SeriesGraphView } from "./catalogTypes.js";

// A broken edge points at a node id not present in the graph (Twine's broken-link surfacing).
export interface BrokenLink {
  from: string;
  to: string;
  // Which endpoint is missing, for a precise message.
  missing: "from" | "to" | "both";
}

export function brokenLinks(view: SeriesGraphView): BrokenLink[] {
  const ids = new Set(view.nodes.map((n) => n.id));
  const out: BrokenLink[] = [];
  for (const e of view.edges) {
    const missingFrom = !ids.has(e.from);
    const missingTo = !ids.has(e.to);
    if (missingFrom || missingTo) {
      out.push({ from: e.from, to: e.to, missing: missingFrom && missingTo ? "both" : missingFrom ? "from" : "to" });
    }
  }
  return out;
}

// Nodes that no edge can reach (excluding declared entry candidates: nodes with no incoming AND no outgoing
// are orphans; a node with outgoing only is a legitimate entry). An orphan with neither in nor out edges is
// surfaced as a warning so the author can connect it.
export function orphanNodes(view: SeriesGraphView): GraphNode[] {
  const hasIn = new Set(view.edges.map((e) => e.to));
  const hasOut = new Set(view.edges.map((e) => e.from));
  return view.nodes.filter((n) => !hasIn.has(n.id) && !hasOut.has(n.id));
}

// Publish-readiness: BLOCKED when the canon solver fails OR any link is broken. Orphans are a soft warning.
export interface PublishReadiness {
  publishable: boolean;
  // The hard blockers (canon errors + broken links), as human-readable lines.
  blockers: string[];
  // Soft advisories (canon warnings + orphans) that do not block publishing.
  warnings: string[];
}

export function publishReadiness(view: SeriesGraphView): PublishReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const links = brokenLinks(view);
  for (const l of links) {
    const where = l.missing === "both" ? `${l.from} and ${l.to}` : l.missing === "from" ? l.from : l.to;
    blockers.push(`Broken link: an edge points at a missing node (${where}).`);
  }

  for (const iss of view.canon.issues) {
    if (iss.severity === "error") blockers.push(`Canon error: ${iss.message}`);
    else warnings.push(`Canon warning: ${iss.message}`);
  }
  // The solver's own valid flag is authoritative; respect it even if it reported no issue lines.
  if (!view.canon.valid && blockers.length === 0) {
    blockers.push("Canon constraints are not satisfied.");
  }

  for (const o of orphanNodes(view)) {
    warnings.push(`Unconnected node: "${o.title}" has no edges yet.`);
  }

  return { publishable: blockers.length === 0, blockers, warnings };
}

// SIMPLE MODE: a linear timeline is the default. We flatten the graph into the default-path spine: start at
// the entry node (no incoming edge, or the first node), then follow the default edge (or the first outgoing
// edge) until we run out. Branch/premium variants are surfaced as off-spine "offshoots" on each step so the
// author still sees them without the full graph. This is the readable default; Pro reveals the real graph.
export interface TimelineStep {
  node: GraphNode;
  // Off-spine variants reachable from this step (branches, alt-POV, intensity, premium endings).
  offshoots: GraphNode[];
}

export function linearTimeline(view: SeriesGraphView): TimelineStep[] {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const hasIn = new Set(view.edges.map((e) => e.to));
  const entry = view.nodes.find((n) => !hasIn.has(n.id)) ?? view.nodes[0];
  if (!entry) return [];

  const outByFrom = new Map<string, GraphEdge[]>();
  for (const e of view.edges) {
    const arr = outByFrom.get(e.from) ?? [];
    arr.push(e);
    outByFrom.set(e.from, arr);
  }

  const steps: TimelineStep[] = [];
  const seen = new Set<string>();
  let current: GraphNode | undefined = entry;
  while (current && !seen.has(current.id)) {
    const node: GraphNode = current;
    seen.add(node.id);
    const outs: GraphEdge[] = outByFrom.get(node.id) ?? [];
    // The spine continuation: the default edge, else the first edge.
    const spineEdge: GraphEdge | undefined = outs.find((e) => e.isDefault) ?? outs[0];
    const offshoots: GraphNode[] = outs
      .filter((e) => e !== spineEdge)
      .map((e) => byId.get(e.to))
      .filter((n): n is GraphNode => Boolean(n));
    steps.push({ node, offshoots });
    current = spineEdge ? byId.get(spineEdge.to) : undefined;
  }
  return steps;
}

// PRO MODE layout: dependency-free column/row placement. If the node carries col/row we honor them; else we
// assign columns by longest-path depth from the entry and stack rows per column. Pure geometry.
export interface LaidOutNode extends GraphNode {
  col: number;
  row: number;
}

export function layoutColumns(view: SeriesGraphView): { nodes: LaidOutNode[]; maxCol: number; maxRow: number } {
  // Honor explicit col/row when present on every node.
  const allPositioned = view.nodes.length > 0 && view.nodes.every((n) => n.col != null && n.row != null);
  let placed: LaidOutNode[];
  if (allPositioned) {
    placed = view.nodes.map((n) => ({ ...n, col: n.col ?? 0, row: n.row ?? 0 }));
  } else {
    const depth = computeDepth(view);
    const rowCursor = new Map<number, number>();
    placed = view.nodes.map((n) => {
      const col = depth.get(n.id) ?? 0;
      const row = rowCursor.get(col) ?? 0;
      rowCursor.set(col, row + 1);
      return { ...n, col, row };
    });
  }
  const maxCol = Math.max(0, ...placed.map((n) => n.col));
  const maxRow = Math.max(0, ...placed.map((n) => n.row));
  return { nodes: placed, maxCol, maxRow };
}

// Longest-path depth from the entry node(s). Cycle-safe (visited guard); unreachable nodes get depth 0.
function computeDepth(view: SeriesGraphView): Map<string, number> {
  const out = new Map<string, GraphEdge[]>();
  for (const e of view.edges) {
    const arr = out.get(e.from) ?? [];
    arr.push(e);
    out.set(e.from, arr);
  }
  const hasIn = new Set(view.edges.map((e) => e.to));
  const entries = view.nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id);
  const depth = new Map<string, number>();
  const starts = entries.length > 0 ? entries : view.nodes.slice(0, 1).map((n) => n.id);
  for (const s of starts) walk(s, 0, new Set());
  // Any node not reached stays at 0.
  for (const n of view.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
  return depth;

  function walk(id: string, d: number, path: Set<string>) {
    if (path.has(id)) return; // cycle guard
    const prev = depth.get(id);
    if (prev == null || d > prev) depth.set(id, d);
    path.add(id);
    for (const e of out.get(id) ?? []) walk(e.to, d + 1, path);
    path.delete(id);
  }
}
