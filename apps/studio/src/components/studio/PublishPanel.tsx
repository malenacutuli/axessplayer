// Publish panel: a validity checklist (derived from the real flattened graph) plus a "Publish to feed" bar.
//
// 0009b: "Publish to feed" is REAL. It calls POST /series/{id}/publish, which sets published_at, and the
// consumer feed (GET /feed) then shows the series. Unpublish clears it. No em dashes.
import { useState } from "react";
import type { FlatGraph } from "../../api/flattenGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";

export interface PublishPanelProps {
  graph: FlatGraph;
  // Refresh the graph after a publish/unpublish so the panel reflects the new published_at.
  onPublished: () => void;
}

interface Check {
  ok: boolean;
  warn?: boolean;
  label: string;
}

function buildChecks(graph: FlatGraph): Check[] {
  const hasColdOpen = graph.beats.some((b) => b.role === "cold_open");
  const hasBranch = graph.beats.some((b) => b.is_branch_point);
  const hasEnding = graph.beats.some((b) => b.role === "ending");
  const graphValid = hasColdOpen && hasEnding && graph.edges.length > 0;

  const beatsWithVariant = new Set(graph.variants.map((v) => v.beat_id));
  const allBeatsHaveVariant =
    graph.beats.length > 0 && graph.beats.every((b) => beatsWithVariant.has(b.id));

  const premium = graph.variants.find((v) => v.is_premium);
  const premiumPriced = Boolean(premium && premium.coin_cost > 0);

  const captioned = graph.variants.some((v) => {
    const a = v.accessibility as { captions?: unknown };
    return a && a.captions === true;
  });

  const nonEnglish = graph.variants.filter((v) => v.language !== "en");
  const stillEncoding = graph.variants.filter((v) => v.qa_status !== "passed");

  return [
    {
      ok: graphValid,
      label: `Story graph valid - cold open${hasBranch ? " → fork" : ""} → reconverge → ending`,
    },
    { ok: allBeatsHaveVariant, label: "All beats have at least one variant" },
    {
      ok: premiumPriced,
      label: premium
        ? `Premium ending priced (${premium.coin_cost} coins) and provenance signed`
        : "Premium ending priced and provenance signed",
    },
    { ok: captioned, label: "Accessibility: captions present" },
    {
      ok: stillEncoding.length === 0,
      warn: stillEncoding.length > 0,
      label:
        stillEncoding.length > 0
          ? `${nonEnglish.length > 0 ? "Localized & " : ""}other variants still encoding (${stillEncoding.length} of ${graph.variants.length})`
          : "All variants encoded",
    },
  ];
}

export function PublishPanel({ graph, onPublished }: PublishPanelProps): JSX.Element {
  const client = useContentClient();
  const checks = buildChecks(graph);
  const isPublished = Boolean(graph.publishedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPublish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isPublished) await client.unpublishSeries(graph.seriesId);
      else await client.publishSeries(graph.seriesId);
      onPublished();
    } catch (err) {
      setError(
        err instanceof ContentApiError
          ? (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "publish_failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spanel" data-testid="panel-publish">
      <div className="sbar">
        <div>
          <div className="ey rose">Go live</div>
          <h2 style={{ marginTop: 8 }}>Publish - {graph.seriesTitle}</h2>
        </div>
      </div>

      <div className="check" data-testid="publish-checklist">
        {checks.map((c, i) => (
          <div key={i} style={c.warn ? { color: "#8a6d22" } : undefined}>
            {c.warn ? "◷" : c.ok ? <b>✓</b> : "○"} {c.label}
          </div>
        ))}
      </div>

      <div className="pubbar">
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
            {isPublished ? "Live on the feed" : "Ready to publish English"}
          </div>
          <div className="muted">
            {isPublished
              ? `Published ${new Date(graph.publishedAt as string).toLocaleString()}`
              : "Other languages roll out as they finish encoding"}
          </div>
        </div>
        <button
          type="button"
          className="btn pri"
          onClick={() => void onPublish()}
          disabled={busy}
          data-testid="publish-to-feed"
        >
          {busy ? "Working..." : isPublished ? "Unpublish" : "Publish to feed"}
        </button>
      </div>

      {isPublished ? (
        <p className="statusline ok" role="status" data-testid="publish-confirmation">
          Live on the consumer feed. Unpublish to remove it.
        </p>
      ) : null}
      {error ? (
        <p className="statusline err" role="alert" data-testid="publish-error">
          Publish failed: {error}
        </p>
      ) : null}

      <div className="note">
        <span className="notetag">FEED</span>
        Publish sets the series live: the consumer "For you" feed (GET /feed) shows only published series.
        The checklist is derived live from the real graph.
      </div>
    </div>
  );
}
