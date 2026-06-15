// The content client: resolve a series into a playable graph for the feed and the player.
//
// The content contract (content.yaml v0.3.1) declares GET /series/{id}/graph but leaves the 200 body
// unschematized ("description: graph"), so openapi-typescript cannot give us a body type. We define
// the graph shape here, mirroring the frozen schema (contracts/schema, supabase/seed.sql): series,
// episodes, beats, variants, edges. This is a documented local mirror, not a second contract. When
// W0 schematizes the 200 body we replace SeriesGraph with the generated type and a contract-change
// request is filed if the shapes differ. The path + operation id ARE bound to the generated client.
// No em dashes.

import type { operations } from "../../../../contracts/types/generated/content.js";
import { apiFetch } from "./http.js";
import type { SessionProvider } from "./session.js";

// Bind the path param to the generated operation so a contract rename is a typecheck failure here.
export type SeriesGraphPath = operations["getSeriesGraph"]["parameters"]["path"];

export interface SeriesNode {
  id: string;
  title: string;
  genre: string;
  base_language: string;
}

export interface EpisodeNode {
  id: string;
  series_id: string;
  episode_number: number;
  title: string;
  is_free: boolean;
  coin_cost: number;
}

export interface BeatNode {
  id: string;
  episode_id: string;
  beat_index: number;
  role: string;
  is_branch_point: boolean;
}

// One playable cut. accessibility carries the variant's a11y track availability so the player can
// default captions / audio description / sign / language on where the variant provides them.
export interface VariantNode {
  id: string;
  beat_id: string;
  language: string;
  intensity: number;
  tier: string;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  accessibility?: VariantAccessibility;
}

export interface VariantAccessibility {
  captions?: boolean;
  audio_description?: boolean;
  sign?: boolean;
  languages?: string[];
}

export interface EdgeNode {
  from_beat_id: string;
  to_beat_id: string;
  condition: Record<string, unknown>;
}

export interface SeriesGraph {
  series: SeriesNode;
  episodes: EpisodeNode[];
  beats: BeatNode[];
  variants: VariantNode[];
  edges: EdgeNode[];
}

export interface ContentClient {
  getSeriesGraph(seriesId: string): Promise<SeriesGraph>;
}

export interface ContentClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

export function createContentClient(opts: ContentClientOptions): ContentClient {
  const { baseUrl, session } = opts;
  return {
    async getSeriesGraph(seriesId: string): Promise<SeriesGraph> {
      const path: SeriesGraphPath = { id: seriesId };
      return apiFetch<SeriesGraph>(baseUrl, `/series/${path.id}/graph`, session, {
        fetch: opts.fetch,
      });
    },
  };
}

// Helpers the feed and player use to walk the graph.

export function coldOpenBeat(graph: SeriesGraph): BeatNode | undefined {
  return (
    graph.beats.find((b) => b.role === "cold_open") ??
    [...graph.beats].sort((a, b) => a.beat_index - b.beat_index)[0]
  );
}

export function variantForBeat(graph: SeriesGraph, beatId: string): VariantNode | undefined {
  return graph.variants.find((v) => v.beat_id === beatId && !v.is_premium) ??
    graph.variants.find((v) => v.beat_id === beatId);
}

export function premiumVariants(graph: SeriesGraph): VariantNode[] {
  return graph.variants.filter((v) => v.is_premium);
}
