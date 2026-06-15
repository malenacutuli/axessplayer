// Load a series graph (flattened, beat_id re-stamped) and re-load when the series id or a reload token
// changes. Shared by the branch editor, media, pricing, and publish panels so they read one consistent
// flattened graph. No em dashes.
import { useCallback, useEffect, useState } from "react";
import { useContentClient } from "./useContentClient.js";
import { ContentApiError } from "./client.js";
import type { FlatGraph } from "./flattenGraph.js";

export type FlatGraphState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; graph: FlatGraph }
  | { status: "error"; message: string };

export function useFlatGraph(seriesId: string, reloadToken: number): FlatGraphState {
  const client = useContentClient();
  const [state, setState] = useState<FlatGraphState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!seriesId) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const graph = await client.getFlatGraph(seriesId);
      setState({ status: "loaded", graph });
    } catch (e) {
      const message =
        e instanceof ContentApiError && e.status === 404
          ? "series_not_found"
          : e instanceof Error
            ? e.message
            : "load_failed";
      setState({ status: "error", message });
    }
  }, [client, seriesId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return state;
}
