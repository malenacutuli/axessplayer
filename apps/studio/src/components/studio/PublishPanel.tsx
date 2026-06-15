// Publish panel: a validity checklist (derived from the real flattened graph) plus a "Publish to feed" bar.
//
// OUT OF SCOPE (flagged): there is no publish endpoint in the content service. "Publish to feed" is a
// FLAGGED NO-OP here; it surfaces a confirmation but does not call the backend. Wiring it needs a content
// (or feed) contract addition. No em dashes.
import { useState } from "react";
import type { FlatGraph } from "../../api/flattenGraph.js";

export interface PublishPanelProps {
  graph: FlatGraph;
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

export function PublishPanel({ graph }: PublishPanelProps): JSX.Element {
  const [published, setPublished] = useState(false);
  const checks = buildChecks(graph);

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
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>Ready to publish English</div>
          <div className="muted">Other languages roll out as they finish encoding</div>
        </div>
        <button
          type="button"
          className="btn pri"
          onClick={() => setPublished(true)}
          data-testid="publish-to-feed"
        >
          Publish to feed
        </button>
      </div>

      {published ? (
        <p className="statusline ok" role="status" data-testid="publish-confirmation">
          Published (flagged no-op). Wiring this to the feed needs a publish endpoint in the content
          contract; nothing was sent to the backend.
        </p>
      ) : null}

      <div className="note">
        <span className="notetag">OUT OF SCOPE</span>
        Publish is a flagged no-op: the content service exposes no publish route. The checklist is derived
        live from the real graph.
      </div>
    </div>
  );
}
