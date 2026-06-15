// StudioPage: the authoring workspace. Pick a series id, view its graph, and create episodes, beats,
// variants, and edges against the live content service. A successful create bumps a reload token so the
// graph refreshes and the beat and episode pickers stay in sync. No em dashes.
import { useCallback, useMemo, useState } from "react";
import { GraphViewer } from "./GraphViewer.js";
import {
  CreateSeriesForm,
  CreateEpisodeForm,
  CreateBeatForm,
  CreateVariantForm,
  CreateEdgeForm,
} from "./AuthoringForms.js";
import type { SeriesGraph } from "../api/contractGap.js";

export function StudioPage(): JSX.Element {
  const [seriesId, setSeriesId] = useState("");
  const [seriesIdInput, setSeriesIdInput] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [graph, setGraph] = useState<SeriesGraph | null>(null);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const onGraphLoaded = useCallback((g: SeriesGraph) => setGraph(g), []);

  const onCreated = useCallback(
    (_kind: string, _id: string) => {
      reload();
    },
    [reload],
  );

  const onSeriesCreated = useCallback(
    (id: string) => {
      setSeriesId(id);
      setSeriesIdInput(id);
      reload();
    },
    [reload],
  );

  const episodeOptions = useMemo(
    () =>
      (graph?.episodes ?? []).map((ep) => ({
        id: ep.id,
        label: `Episode ${ep.episode_number}${ep.title ? `: ${ep.title}` : ""}`,
      })),
    [graph],
  );

  const beatOptions = useMemo(
    () =>
      (graph?.episodes ?? []).flatMap((ep) =>
        ep.beats.map((beat) => ({
          id: beat.id,
          label: `Ep ${ep.episode_number} / beat #${beat.beat_index} [${beat.role}]`,
        })),
      ),
    [graph],
  );

  return (
    <main>
      <h1>Axessplayer Studio</h1>

      <section aria-label="Series selector">
        <label>
          Series id
          <input
            value={seriesIdInput}
            onChange={(e) => setSeriesIdInput(e.target.value)}
            data-testid="series-id-input"
            placeholder="series uuid"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setSeriesId(seriesIdInput.trim());
            reload();
          }}
          data-testid="load-series"
        >
          Load graph
        </button>
      </section>

      <CreateSeriesForm onSeriesCreated={onSeriesCreated} />

      <GraphViewer seriesId={seriesId} reloadToken={reloadToken} onGraphLoaded={onGraphLoaded} />

      {seriesId && (
        <section aria-label="Authoring">
          <CreateEpisodeForm seriesId={seriesId} onCreated={onCreated} />
          <CreateBeatForm
            seriesId={seriesId}
            episodeOptions={episodeOptions}
            onCreated={onCreated}
          />
          <CreateVariantForm beatOptions={beatOptions} onCreated={onCreated} />
          <CreateEdgeForm beatOptions={beatOptions} onCreated={onCreated} />
        </section>
      )}
    </main>
  );
}
