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
      const raw = await apiFetch<RawSeriesGraph>(baseUrl, `/series/${path.id}/graph`, session, {
        fetch: opts.fetch,
      });
      return flattenGraph(raw);
    },
  };
}

// The content service returns a NESTED graph (episodes[].beats[].variants[]) plus top-level edges, while
// the components consume a FLAT graph (top-level beats, and variants carrying beat_id). Normalize at this
// boundary. When content.yaml schematizes the 200 body and both sides bind one generated type, this
// flatten goes away. No em dashes.
interface RawSeriesGraph {
  series: SeriesNode;
  episodes: Array<{
    id: string;
    episode_number: number;
    title: string;
    is_free: boolean;
    coin_cost: number;
    beats: Array<{
      id: string;
      episode_id: string;
      beat_index: number;
      role: string;
      is_branch_point: boolean;
      variants: Array<Omit<VariantNode, "beat_id">>;
    }>;
  }>;
  edges: EdgeNode[];
}

function flattenGraph(raw: RawSeriesGraph): SeriesGraph {
  const episodes: EpisodeNode[] = [];
  const beats: BeatNode[] = [];
  const variants: VariantNode[] = [];
  for (const ep of raw.episodes ?? []) {
    episodes.push({
      id: ep.id,
      series_id: raw.series.id,
      episode_number: ep.episode_number,
      title: ep.title,
      is_free: ep.is_free,
      coin_cost: ep.coin_cost,
    });
    for (const b of ep.beats ?? []) {
      beats.push({
        id: b.id,
        episode_id: b.episode_id,
        beat_index: b.beat_index,
        role: b.role,
        is_branch_point: b.is_branch_point,
      });
      for (const v of b.variants ?? []) {
        variants.push({ ...v, beat_id: b.id });
      }
    }
  }
  return { series: raw.series, episodes, beats, variants, edges: raw.edges ?? [] };
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

// Build the chosen-variant -> beat resolver the SDK BranchingPlayer needs to advance. /decide takes a
// beat id and returns the next cut's VARIANT id; to make the next /decide we must resolve that variant
// back to its beat. Variants carry beat_id (the flatten boundary keeps this), so this is a lookup.
// Unknown ids fall back to the id itself so a stray variant never wedges the walk. No em dashes.
export function variantToBeatResolver(graph: SeriesGraph): (variantId: string) => string {
  const byVariant = new Map<string, string>();
  for (const v of graph.variants) byVariant.set(v.id, v.beat_id);
  return (variantId: string) => byVariant.get(variantId) ?? variantId;
}
