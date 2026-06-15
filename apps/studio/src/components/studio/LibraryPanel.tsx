// Library panel: the grid of series cards with gradient covers and LIVE / DRAFT / OUTLINE publish badges.
// The first card is the real seeded series and opens the branch editor; the rest are styled placeholders
// (no list-series endpoint exists yet). A "New episode" action also opens the branch editor. No em dashes.
import { LIBRARY_CARDS, type LibraryCard } from "../../api/knownSeries.js";

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
              <div className={`ph ${card.gradientClass}`} />
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
