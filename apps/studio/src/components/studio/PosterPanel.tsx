// Poster panel: generate a title poster for the series. The author picks a style and clicks Generate; the
// content service generates the image SERVER-SIDE (the project stability-ai edge function), uploads it to
// public storage, and persists series.poster_url with C2PA + Article 50 provenance. The generation key
// never reaches the browser. The chosen poster then renders on the Studio library card and the consumer
// feed card. If generation is unconfigured the panel surfaces the server error rather than faking it. No
// em dashes.

import { useState } from "react";
import type { FlatGraph } from "../../api/flattenGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import { POSTER_STYLES, type PosterStyle } from "../../api/poster.js";

export interface PosterPanelProps {
  graph: FlatGraph;
  // Refresh the graph after a poster is set so the card reflects it.
  onPosterSet: () => void;
}

export function PosterPanel({ graph, onPosterSet }: PosterPanelProps): JSX.Element {
  const client = useContentClient();
  const [style, setStyle] = useState<PosterStyle>(POSTER_STYLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const prompt = `${graph.seriesTitle}. ${style.prompt}. Vertical 9:16 poster, no text.`;
      await client.generateSeriesPoster(graph.seriesId, prompt);
      onPosterSet();
    } catch (err) {
      setError(
        err instanceof ContentApiError
          ? err.status === 501
            ? "Poster generation is not configured on the server (STABILITY_AI_API_KEY)."
            : (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "generation_failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spanel" data-testid="panel-poster">
      <div className="sbar">
        <div>
          <div className="ey rose">Promotional art</div>
          <h2 style={{ marginTop: 8 }}>Poster - {graph.seriesTitle}</h2>
        </div>
      </div>

      {graph.posterUrl ? (
        <div className="insp" style={{ marginBottom: 16 }}>
          <div>
            <div className="scaption">Current poster</div>
            <img
              src={graph.posterUrl}
              alt={`${graph.seriesTitle} poster`}
              data-testid="current-poster"
              data-poster-url={graph.posterUrl}
              style={{ width: 180, aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 12, marginTop: 8 }}
            />
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>AI-generated, C2PA-signed (synthetic), Article 50 labelled.</p>
          </div>
        </div>
      ) : null}

      <div className="fld">
        <label htmlFor="poster-style">Style</label>
        <select
          id="poster-style"
          value={style.id}
          onChange={(e) => setStyle(POSTER_STYLES.find((s) => s.id === e.target.value) ?? POSTER_STYLES[0])}
        >
          {POSTER_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rowend">
        <button
          type="button"
          className="btn pri"
          onClick={() => void onGenerate()}
          disabled={busy}
          data-testid="poster-generate"
        >
          {busy ? "Generating..." : graph.posterUrl ? "Regenerate poster" : "Generate poster"}
        </button>
      </div>

      {error ? (
        <p className="statusline err" role="alert" data-testid="poster-error">
          {error}
        </p>
      ) : null}

      <div className="note">
        <span className="notetag">REUSE</span>
        Posters are generated server-side by the project image pipeline (stability-ai), uploaded to public
        storage, and persisted on the series. Every poster is AI-generated, so it is C2PA-signed and marked
        synthetic for the Article 50 disclosure, and rendered on the library and feed cards.
      </div>
    </div>
  );
}
