// Flatten the nested series graph at the client boundary.
//
// The live content service returns GET /series/{id}/graph as a NESTED shape:
//   { series, episodes: [ { ..., beats: [ { id, ..., variants: [ { id, ... } ] } ] } ], edges: [] }
// The variants nested under a beat do NOT carry their own beat_id (the parent key is implicit in the
// nesting). The consumer app hit exactly this bug: code that read a flat variant list assumed each variant
// knew its beat, and it did not. So here, at the boundary, we FLATTEN the tree into flat arrays and
// RE-STAMP beat_id (and episode context) onto every variant. Every surface downstream (branch editor,
// media list, pricing) consumes the flat shape, so the bug cannot recur. No em dashes.

import type { SeriesGraph, GraphEdge, BeatRole, VariantTier, QaStatus } from "./contractGap.js";

// A beat lifted out of the tree, carrying its episode context.
export interface FlatBeat {
  id: string;
  episode_id: string;
  episode_number: number;
  episode_title: string | null;
  beat_index: number;
  role: BeatRole;
  is_branch_point: boolean;
  canon_facts: Record<string, unknown>;
  variant_ids: string[];
}

// A variant lifted out of the tree with beat_id RE-STAMPED on it. This is the fix for the nested-graph bug.
export interface FlatVariant {
  id: string;
  beat_id: string; // re-stamped from the parent beat: the service omits it in the nested response
  beat_index: number;
  beat_role: BeatRole;
  episode_id: string;
  episode_number: number;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  qa_status: QaStatus;
}

export interface FlatGraph {
  seriesId: string;
  seriesTitle: string;
  baseLanguage: string;
  episodeCount: number;
  beats: FlatBeat[];
  variants: FlatVariant[];
  edges: GraphEdge[];
  // Quick lookup of a beat by id, for edge rendering and selection.
  beatById: Map<string, FlatBeat>;
}

// Flatten the nested graph and re-stamp beat_id onto every variant.
export function flattenGraph(graph: SeriesGraph): FlatGraph {
  const beats: FlatBeat[] = [];
  const variants: FlatVariant[] = [];

  for (const ep of graph.episodes) {
    for (const beat of ep.beats) {
      const variantIds: string[] = [];
      for (const v of beat.variants) {
        variantIds.push(v.id);
        variants.push({
          id: v.id,
          // RE-STAMP: the parent beat id, which the nested response does not put on the variant.
          beat_id: beat.id,
          beat_index: beat.beat_index,
          beat_role: beat.role,
          episode_id: ep.id,
          episode_number: ep.episode_number,
          language: v.language,
          accessibility: v.accessibility,
          intensity: v.intensity,
          pov: v.pov,
          tier: v.tier,
          is_premium: v.is_premium,
          coin_cost: v.coin_cost,
          playback_url: v.playback_url,
          duration_ms: v.duration_ms,
          qa_status: v.qa_status,
        });
      }
      beats.push({
        id: beat.id,
        episode_id: ep.id,
        episode_number: ep.episode_number,
        episode_title: ep.title,
        beat_index: beat.beat_index,
        role: beat.role,
        is_branch_point: beat.is_branch_point,
        canon_facts: beat.canon_facts,
        variant_ids: variantIds,
      });
    }
  }

  const beatById = new Map<string, FlatBeat>();
  for (const b of beats) beatById.set(b.id, b);

  return {
    seriesId: graph.series.id,
    seriesTitle: graph.series.title,
    baseLanguage: graph.series.base_language,
    episodeCount: graph.episodes.length,
    beats,
    variants,
    edges: graph.edges,
    beatById,
  };
}
