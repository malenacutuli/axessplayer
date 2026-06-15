// GraphViewer: load a series graph by id (GET /series/{id}/graph) and render its episodes, beats,
// variants, and edges. This is the READ surface. It binds to the graph model from contractGap.ts (which
// will become the codegen 200 type once the contract gains a response schema). No em dashes.
import { useCallback, useEffect, useState } from "react";
import { useContentClient } from "../api/useContentClient.js";
import type { SeriesGraph } from "../api/contractGap.js";
import { ContentApiError } from "../api/client.js";

export interface GraphViewerProps {
  seriesId: string;
  // Bump this to force a reload after an authoring mutation lands.
  reloadToken?: number;
  // Lets the page index beats for the variant and edge forms.
  onGraphLoaded?: (graph: SeriesGraph) => void;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; graph: SeriesGraph }
  | { status: "error"; message: string };

export function GraphViewer({ seriesId, reloadToken, onGraphLoaded }: GraphViewerProps): JSX.Element {
  const client = useContentClient();
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!seriesId) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const graph = await client.getSeriesGraph(seriesId);
      setState({ status: "loaded", graph });
      onGraphLoaded?.(graph);
    } catch (e) {
      const message =
        e instanceof ContentApiError && e.status === 404
          ? "series_not_found"
          : e instanceof Error
            ? e.message
            : "load_failed";
      setState({ status: "error", message });
    }
  }, [client, seriesId, onGraphLoaded]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  if (state.status === "idle") {
    return <p data-testid="graph-idle">Enter a series id to load its graph.</p>;
  }
  if (state.status === "loading") {
    return <p data-testid="graph-loading">Loading graph...</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" data-testid="graph-error">
        Could not load graph: {state.message}
      </p>
    );
  }

  const { graph } = state;
  return (
    <section aria-label="Series graph" data-testid="graph-viewer">
      <h2>{graph.series.title}</h2>
      <p>
        Series {graph.series.id} : base language {graph.series.base_language}
      </p>

      <h3>Episodes</h3>
      {graph.episodes.length === 0 ? (
        <p data-testid="no-episodes">No episodes yet.</p>
      ) : (
        <ul data-testid="episode-list">
          {graph.episodes.map((ep) => (
            <li key={ep.id} data-testid={`episode-${ep.id}`}>
              <strong>
                Episode {ep.episode_number}
                {ep.title ? `: ${ep.title}` : ""}
              </strong>{" "}
              ({ep.is_free ? "free" : `${ep.coin_cost} coins`})
              {ep.beats.length === 0 ? (
                <p>No beats.</p>
              ) : (
                <ul>
                  {ep.beats.map((beat) => (
                    <li key={beat.id} data-testid={`beat-${beat.id}`}>
                      Beat #{beat.beat_index} [{beat.role}]
                      {beat.is_branch_point ? " (branch point)" : ""}
                      {beat.variants.length > 0 && (
                        <ul>
                          {beat.variants.map((v) => (
                            <li key={v.id} data-testid={`variant-${v.id}`}>
                              {v.language} / {v.tier} / intensity {v.intensity}
                              {v.is_premium ? " / premium" : ""} / {v.coin_cost} coins
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Edges</h3>
      {graph.edges.length === 0 ? (
        <p data-testid="no-edges">No edges yet.</p>
      ) : (
        <ul data-testid="edge-list">
          {graph.edges.map((edge, i) => (
            <li key={`${edge.from_beat_id}-${edge.to_beat_id}-${i}`} data-testid="edge-item">
              {edge.from_beat_id} to {edge.to_beat_id}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
