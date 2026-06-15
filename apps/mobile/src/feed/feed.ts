// The vertical swipe feed's data + logic layer (no rendering). Given the api client and a list of series
// ids (the feed's order, supplied by a discovery surface), it loads each series graph and flattens it
// into an ordered list of FEED ITEMS: one card per episode, each carrying the cold-open beat the player
// should start on. The native FlatList/PagerView screen renders these and pages through them; this layer
// is what the component tests exercise. No em dashes.

import type { ApiClient } from "../api/client.js";
import { parseSeriesGraph, type SeriesGraph } from "./graph.js";

// One card in the vertical feed: an episode within its series, with everything the player screen needs to
// start (the series, the episode, and the cold-open beat id).
export interface FeedItem {
  key: string; // stable list key: `${seriesId}:${episodeId}`
  seriesId: string;
  seriesTitle?: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle?: string;
  isFree: boolean;
  coinCost?: number;
  // The beat the player opens on for this episode (BranchingPlayer.startBeatId).
  coldOpenBeatId: string | undefined;
}

// Load and flatten the feed. Series that fail to load are skipped (the feed degrades to what loaded
// rather than failing whole); their ids are returned in `failed` so the host can retry or report.
export interface FeedLoadResult {
  items: FeedItem[];
  failed: string[];
}

export async function loadFeed(
  client: ApiClient,
  seriesIds: readonly string[]
): Promise<FeedLoadResult> {
  const items: FeedItem[] = [];
  const failed: string[] = [];

  const graphs = await Promise.all(
    seriesIds.map(async (id) => {
      try {
        const raw = await client.getSeriesGraph(id);
        return { id, graph: parseSeriesGraph(id, raw) };
      } catch {
        return { id, graph: null };
      }
    })
  );

  for (const { id, graph } of graphs) {
    if (!graph) {
      failed.push(id);
      continue;
    }
    items.push(...toFeedItems(graph));
  }
  return { items, failed };
}

// Flatten one series graph into ordered episode cards.
export function toFeedItems(graph: SeriesGraph): FeedItem[] {
  return graph.episodes.map((ep) => ({
    key: `${graph.id}:${ep.id}`,
    seriesId: graph.id,
    seriesTitle: graph.title,
    episodeId: ep.id,
    episodeNumber: ep.episodeNumber,
    episodeTitle: ep.title,
    isFree: ep.isFree ?? false,
    coinCost: ep.coinCost,
    coldOpenBeatId: ep.coldOpenBeatId,
  }));
}
