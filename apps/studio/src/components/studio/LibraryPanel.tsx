// Library panel: the grid of series cards with gradient covers and LIVE / DRAFT / OUTLINE publish badges.
// The first card is the real seeded series and opens the branch editor; the rest are styled placeholders
// (no list-series endpoint exists yet). A "New episode" action also opens the branch editor. No em dashes.
import { useEffect, useState } from "react";
import { LIBRARY_CARDS, type LibraryCard } from "../../api/knownSeries.js";
import { useContentClient } from "../../api/useContentClient.js";

export interface LibraryPanelProps {
  // Open the branch editor for a given series (the real seed id), or for the active series via New episode.
  onOpenSeries: (seriesId: string | undefined) => void;
}

function PublishBadge({ state }: { state: LibraryCard["publish"] }): JSX.Element {
  const cls = state === "live" ? "pub live" : "pub draft";
  const label = state === "live" ? "LIVE" : state === "draft" ? "DRAFT" : "OUTLINE";
  return <span className={cls}>{label}</span>;
}

export function LibraryPanel({ onOpenSeries }: LibraryPanelProps): JSX.Element {
  const live = LIBRARY_CARDS.find((c) => c.publish === "live");
  const client = useContentClient();
  // The live card shows the real generated poster (0009c) when one is set; the gradient is the fallback.
  const [livePoster, setLivePoster] = useState<string | null>(null);
  useEffect(() => {
    if (!live?.seriesId) return;
    let alive = true;
    void client
      .getSeriesGraph(live.seriesId)
      .then((g) => {
        if (alive) setLivePoster(g.series.poster_url ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, live?.seriesId]);
  return (
    <div className="spanel" data-testid="panel-library">
      <div className="sbar">
        <div>
          <div className="ey rose">Content back end</div>
          <h2 style={{ marginTop: 8 }}>Library</h2>
        </div>
        <button
          type="button"
          className="btn pri"
          onClick={() => onOpenSeries(live?.seriesId)}
          data-testid="new-episode"
        >
          + New episode
        </button>
      </div>

      <div className="libgrid" data-testid="library-grid">
        {LIBRARY_CARDS.map((card) => {
          const clickable = Boolean(card.seriesId);
          const poster = card.publish === "live" ? livePoster : null;
          return (
            <button
              key={card.title}
              type="button"
              className="lib"
              disabled={!clickable}
              onClick={() => clickable && onOpenSeries(card.seriesId)}
              data-testid={`library-card-${card.publish}`}
              aria-label={`${card.title} (${card.publish})`}
            >
              <div
                className={`ph ${poster ? "" : card.gradientClass}`}
                data-testid={card.publish === "live" ? "library-poster-live" : undefined}
                data-poster-url={poster ?? ""}
                style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              />
              <div className="b">
                <div className="t">{card.title}</div>
                <div className="s">
                  <PublishBadge state={card.publish} />
                  {card.subtitle ? <span>{card.subtitle}</span> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="note">
        <span className="notetag">FILLS THE GAP</span>
        The content upload tool that did not exist. It writes to the same content graph the player reads
        from.
      </div>
    </div>
  );
}
