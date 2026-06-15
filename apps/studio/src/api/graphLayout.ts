// Lay out the flat graph as positioned nodes plus SVG edge paths for the branch editor canvas.
//
// The prototype hand-positions six nodes (cold open -> branch point -> calm / tense -> shared ending, plus
// a gold premium node) and draws rose curves for the per-viewer fork and a gold dashed curve for the
// premium coin-gated branch. We reproduce that look from REAL data: columns come from each beat's depth
// (longest path from a root), rows lane the beats sharing a column, and a beat that carries a premium
// variant is rendered as the gold premium node. Edge styling: an edge OUT of a branch point is a rose fork
// path; an edge INTO a premium-bearing beat is the gold dashed path; everything else is a neutral hairline.
// No em dashes.

import type { FlatGraph, FlatBeat } from "./flattenGraph.js";

export interface LaidOutNode {
  beat: FlatBeat;
  x: number;
  y: number;
  // The role label shown in the node header (mono uppercase), derived to match the prototype vocabulary.
  kicker: string;
  name: string;
  detail: string;
  isPremium: boolean;
  premiumCoinCost: number | null;
}

export type EdgeKind = "neutral" | "fork" | "premium";
export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  path: string; // SVG path d
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const NODE_W = 142;
const NODE_H = 86;
const COL_GAP = 80;
const ROW_GAP = 34;
const PAD_X = 10;
const PAD_Y = 14;

// Depth of each beat = longest path from any root (a beat with no incoming edge). Cycles are guarded.
function computeDepths(graph: FlatGraph): Map<string, number> {
  const incoming = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const b of graph.beats) {
    incoming.set(b.id, 0);
    adj.set(b.id, []);
  }
  for (const e of graph.edges) {
    if (!adj.has(e.from_beat_id) || !incoming.has(e.to_beat_id)) continue;
    adj.get(e.from_beat_id)!.push(e.to_beat_id);
    incoming.set(e.to_beat_id, (incoming.get(e.to_beat_id) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  for (const b of graph.beats) depth.set(b.id, 0);
  // Kahn-style longest path. Seed with roots; if everything has an incoming edge (cycle), seed all at 0.
  const queue: string[] = graph.beats.filter((b) => (incoming.get(b.id) ?? 0) === 0).map((b) => b.id);
  const remaining = new Map(incoming);
  const seen = new Set<string>();
  let guard = graph.beats.length * 4 + 8;
  if (queue.length === 0) graph.beats.forEach((b) => queue.push(b.id));
  while (queue.length > 0 && guard-- > 0) {
    const id = queue.shift()!;
    seen.add(id);
    const d = depth.get(id) ?? 0;
    for (const next of adj.get(id) ?? []) {
      if (d + 1 > (depth.get(next) ?? 0)) depth.set(next, d + 1);
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      if (left <= 0 && !seen.has(next)) queue.push(next);
    }
  }
  // Fallback: any beat never reached keeps depth by beat_index so it is at least positioned.
  for (const b of graph.beats) {
    if (!seen.has(b.id) && (depth.get(b.id) ?? 0) === 0) depth.set(b.id, b.beat_index);
  }
  return depth;
}

function premiumInfo(beat: FlatBeat, graph: FlatGraph): { isPremium: boolean; coinCost: number | null } {
  let isPremium = false;
  let coinCost: number | null = null;
  for (const v of graph.variants) {
    if (v.beat_id === beat.id && v.is_premium) {
      isPremium = true;
      coinCost = v.coin_cost;
    }
  }
  return { isPremium, coinCost };
}

function kickerFor(beat: FlatBeat, graph: FlatGraph): string {
  if (beat.is_branch_point) return "Branch point";
  switch (beat.role) {
    case "cold_open":
      return "Cold open";
    case "ending":
      return premiumInfo(beat, graph).isPremium ? "Premium" : "Ending";
    case "variant":
      return "Variant cut";
    case "hero":
      return "Hero";
    case "connective":
      return "Connective";
    default:
      return "Spine";
  }
}

function nameFor(beat: FlatBeat, graph: FlatGraph): string {
  // Prefer a human label if canon_facts carries one, else a stable beat reference.
  const facts = beat.canon_facts as { label?: unknown; title?: unknown };
  if (typeof facts.label === "string" && facts.label) return facts.label;
  if (typeof facts.title === "string" && facts.title) return facts.title;
  if (premiumInfo(beat, graph).isPremium) return "Alt ending";
  return `Beat ${beat.beat_index}`;
}

function detailFor(beat: FlatBeat, graph: FlatGraph): string {
  const vars = graph.variants.filter((v) => v.beat_id === beat.id && !v.is_premium);
  if (beat.is_branch_point) return "fork - intensity";
  if (vars.length === 0) return "no variants";
  const langs = [...new Set(vars.map((v) => v.language))];
  if (vars.length === 1) return `1 variant - ${langs[0] ?? "en"}`;
  return `${vars.length} variants - ${langs.join("/")}`;
}

export function layoutGraph(graph: FlatGraph): GraphLayout {
  const depth = computeDepths(graph);

  // Group beats by column (depth), then sort within a column for a stable lane order.
  const byCol = new Map<number, FlatBeat[]>();
  for (const b of graph.beats) {
    const d = depth.get(b.id) ?? 0;
    if (!byCol.has(d)) byCol.set(d, []);
    byCol.get(d)!.push(b);
  }
  // Premium beats sink to the bottom lane; otherwise order by beat_index then id for determinism.
  for (const list of byCol.values()) {
    list.sort((a, b) => {
      const pa = premiumInfo(a, graph).isPremium ? 1 : 0;
      const pb = premiumInfo(b, graph).isPremium ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (a.beat_index !== b.beat_index) return a.beat_index - b.beat_index;
      return a.id.localeCompare(b.id);
    });
  }

  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const maxLanes = Math.max(1, ...[...byCol.values()].map((l) => l.length));

  const pos = new Map<string, { x: number; y: number }>();
  const nodes: LaidOutNode[] = [];

  for (const col of cols) {
    const list = byCol.get(col)!;
    const x = PAD_X + col * (NODE_W + COL_GAP);
    // Vertically center the lane group for this column within the tallest column.
    const groupHeight = list.length * NODE_H + (list.length - 1) * ROW_GAP;
    const fullHeight = maxLanes * NODE_H + (maxLanes - 1) * ROW_GAP;
    const top = PAD_Y + (fullHeight - groupHeight) / 2;
    list.forEach((beat, lane) => {
      const y = top + lane * (NODE_H + ROW_GAP);
      pos.set(beat.id, { x, y });
      const prem = premiumInfo(beat, graph);
      nodes.push({
        beat,
        x,
        y,
        kicker: kickerFor(beat, graph),
        name: nameFor(beat, graph),
        detail: prem.isPremium ? "premium" : detailFor(beat, graph),
        isPremium: prem.isPremium,
        premiumCoinCost: prem.coinCost,
      });
    });
  }

  const premiumBeatIds = new Set(nodes.filter((n) => n.isPremium).map((n) => n.beat.id));
  const branchBeatIds = new Set(graph.beats.filter((b) => b.is_branch_point).map((b) => b.id));

  const edges: LaidOutEdge[] = graph.edges.map((e, i) => {
    const a = pos.get(e.from_beat_id);
    const b = pos.get(e.to_beat_id);
    let kind: EdgeKind = "neutral";
    if (premiumBeatIds.has(e.to_beat_id)) kind = "premium";
    else if (branchBeatIds.has(e.from_beat_id)) kind = "fork";
    const path = a && b ? edgePath(a, b) : "";
    return { id: `${e.from_beat_id}->${e.to_beat_id}-${i}`, from: e.from_beat_id, to: e.to_beat_id, kind, path };
  });

  const lastCol = cols.length > 0 ? cols[cols.length - 1] : 0;
  const width = PAD_X * 2 + (lastCol + 1) * NODE_W + lastCol * COL_GAP;
  const height = PAD_Y * 2 + maxLanes * NODE_H + (maxLanes - 1) * ROW_GAP;
  return { nodes, edges, width: Math.max(width, 480), height: Math.max(height, 240) };
}

// A smooth horizontal cubic from the right edge of node A to the left edge of node B, like the prototype.
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}
