// Poster panel: generate a title poster for the series by reusing the Axessible image pipeline (0009c). The
// author picks a style, generates candidates from the title + logline, picks one, and it is stored on the
// series (PATCH /series/{id}/poster) with C2PA synthetic provenance. The chosen poster then renders on the
// Studio library card and the consumer feed card. When the Axessible endpoint is not configured, the panel
// says so rather than faking a vendor or an image. No em dashes.

import { useState } from "react";
import type { FlatGraph } from "../../api/flattenGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import {
  POSTER_STYLES,
  generatePoster,
  isPosterConfigured,
  posterProvenance,
  PosterNotConfiguredError,
  type PosterCandidate,
  type PosterStyle,
} from "../../api/poster.js";

export interface PosterPanelProps {
  graph: FlatGraph;
  // Refresh the graph after a poster is chosen so the card reflects it.
  onPosterSet: () => void;
}

export function PosterPanel({ graph, onPosterSet }: PosterPanelProps): JSX.Element {
  const client = useContentClient();
  const configured = isPosterConfigured();
  const [style, setStyle] = useState<PosterStyle>(POSTER_STYLES[0]);
  const [candidates, setCandidates] = useState<PosterCandidate[]>([]);
  const [busy, setBusy] = useState<"idle" | "generating" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const logline = graph.seriesTitle + (graph.beats[0]?.canon_facts ? "" : "");

  const onGenerate = async () => {
    setBusy("generating");
    setError(null);
    setCandidates([]);
    try {
      const c = await generatePoster({ title: graph.seriesTitle, logline, style, count: 2 });
      setCandidates(c);
    } catch (err) {
      setError(
        err instanceof PosterNotConfiguredError
          ? "Axessible image endpoint not configured. Set VITE_AXESSIBLE_POSTER_ENDPOINT and VITE_AXESSIBLE_ANON_KEY."
          : err instanceof Error
            ? err.message
            : "generation_failed",
      );
    } finally {
      setBusy("idle");
    }
  };

  const onPick = async (candidate: PosterCandidate) => {
    setBusy("saving");
    setError(null);
    try {
      await client.setSeriesPoster(graph.seriesId, {
        poster_url: candidate.url,
        provenance: posterProvenance(style),
      });
      setCandidates([]);
      onPosterSet();
    } catch (err) {
      setError(
        err instanceof ContentApiError
          ? (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "save_failed",
      );
    } finally {
      setBusy("idle");
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
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>AI-generated, C2PA-signed (synthetic).</p>
          </div>
        </div>
      ) : null}

      {!configured ? (
        <p className="statusline err" role="alert" data-testid="poster-not-configured">
          Connect the Axessible image pipeline to generate posters: set VITE_AXESSIBLE_POSTER_ENDPOINT (the edge
          function URL) and VITE_AXESSIBLE_ANON_KEY, then restart the Studio. No new vendor is added.
        </p>
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
          disabled={!configured || busy !== "idle"}
          data-testid="poster-generate"
        >
          {busy === "generating" ? "Generating..." : "Generate poster"}
        </button>
      </div>

      {candidates.length > 0 ? (
        <div className="vlist" data-testid="poster-candidates" style={{ display: "flex", gap: 12, marginTop: 14 }}>
          {candidates.map((c, i) => (
            <button
              key={c.url}
              type="button"
              className="card"
              onClick={() => void onPick(c)}
              disabled={busy !== "idle"}
              data-testid={`poster-candidate-${i}`}
              aria-label={`Use poster candidate ${i + 1}`}
            >
              <img
                src={c.url}
                alt={`Poster candidate ${i + 1}`}
                style={{ width: 150, aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 12 }}
              />
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="statusline err" role="alert" data-testid="poster-error">
          {error}
        </p>
      ) : null}

      <div className="note">
        <span className="notetag">REUSE</span>
        Posters are generated by the Axessible image pipeline (stability-ai / generate-thumbnail / replicate-ai),
        not a new vendor. Every poster is AI-generated, so it is C2PA-signed and marked synthetic for the Article
        50 disclosure, and rendered on the library and feed cards.
      </div>
    </div>
  );
}
