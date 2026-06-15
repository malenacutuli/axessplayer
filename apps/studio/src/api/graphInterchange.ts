// Canonical content-graph interchange: a diffable, machine-emittable export of the story graph. This is
// Twine's lesson that a plain interchange format is a feature - a series can be version-controlled,
// reviewed, and emitted by the generation pipeline the same way a human authors it. Stable ordering keeps
// diffs clean. It captures AUTHORED intent only (beats, variants, edges, conditions); runtime branching
// stays in the decision engine, never baked into the document. No em dashes.

import type { FlatBeat, FlatGraph, FlatVariant } from "./flattenGraph.js";
import type { GraphEdge } from "./contractGap.js";

export const INTERCHANGE_VERSION = "1.0";

export interface StoryGraphInterchange {
  version: string;
  kind: "axessplayer.story-graph";
  series: { id: string; title: string; base_language: string };
  beats: Array<{
    id: string;
    episode_number: number;
    beat_index: number;
    role: string;
    is_branch_point: boolean;
    canon_facts: Record<string, unknown>;
    variants: Array<{
      id: string;
      language: string;
      intensity: number;
      tier: string;
      is_premium: boolean;
      coin_cost: number;
      pov: string | null;
      accessibility: Record<string, unknown>;
      playback_url: string;
    }>;
  }>;
  edges: Array<{ from: string; to: string; condition: Record<string, unknown> }>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function byBeatOrder(a: FlatBeat, b: FlatBeat): number {
  return a.episode_number - b.episode_number || a.beat_index - b.beat_index || cmp(a.id, b.id);
}

export function toInterchange(graph: FlatGraph): StoryGraphInterchange {
  const variantsByBeat = new Map<string, FlatVariant[]>();
  for (const v of graph.variants) {
    const arr = variantsByBeat.get(v.beat_id) ?? [];
    arr.push(v);
    variantsByBeat.set(v.beat_id, arr);
  }

  const beats = [...graph.beats].sort(byBeatOrder).map((b) => ({
    id: b.id,
    episode_number: b.episode_number,
    beat_index: b.beat_index,
    role: b.role,
    is_branch_point: b.is_branch_point,
    canon_facts: b.canon_facts,
    variants: (variantsByBeat.get(b.id) ?? [])
      .slice()
      .sort((x, y) => cmp(x.id, y.id))
      .map((v) => ({
        id: v.id,
        language: v.language,
        intensity: v.intensity,
        tier: v.tier,
        is_premium: v.is_premium,
        coin_cost: v.coin_cost,
        pov: v.pov,
        accessibility: v.accessibility,
        playback_url: v.playback_url,
      })),
  }));

  const edges = [...graph.edges]
    .sort((a, b) => cmp(a.from_beat_id, b.from_beat_id) || cmp(a.to_beat_id, b.to_beat_id))
    .map((e: GraphEdge) => ({ from: e.from_beat_id, to: e.to_beat_id, condition: e.condition }));

  return {
    version: INTERCHANGE_VERSION,
    kind: "axessplayer.story-graph",
    series: { id: graph.seriesId, title: graph.seriesTitle, base_language: graph.baseLanguage },
    beats,
    edges,
  };
}

export function serializeInterchange(graph: FlatGraph): string {
  return `${JSON.stringify(toInterchange(graph), null, 2)}\n`;
}

// Broken-edge detection (Twine's broken-link surfacing): edges that point at a beat not in the graph.
export function brokenEdges(graph: FlatGraph): Array<{ from: string; to: string }> {
  const ids = new Set(graph.beats.map((b) => b.id));
  return graph.edges
    .filter((e) => !ids.has(e.from_beat_id) || !ids.has(e.to_beat_id))
    .map((e) => ({ from: e.from_beat_id, to: e.to_beat_id }));
}
