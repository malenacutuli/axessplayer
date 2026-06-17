// Library panel: the grid of series cards. The LIVE cards are the REAL published series from GET /feed
// (so the Studio always lists what is actually in the schema, not a hardcoded seed id); the draft/outline
// cards are styled placeholders until those series are authored. Opening a live card loads its graph into
// the branch editor. A "New episode" action opens the active series. No em dashes.
import { useEffect, useState } from "react";
import { LIBRARY_CARDS } from "../../api/knownSeries.js";
import { useContentClient } from "../../api/useContentClient.js";
import type { FeedSeries } from "../../api/client.js";

export interface LibraryPanelProps {
  // Open the branch editor for a given series id (a real published series), or undefined for a new one.
  onOpenSeries: (seriesId: string | undefined) => void;
}

export function LibraryPanel({ onOpenSeries }: LibraryPanelProps): JSX.Element {
  const client = useContentClient();
  const [feed, setFeed] = useState<FeedSeries[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void client
      .getFeed()
      .then((series) => {
        if (alive) setFeed(series);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "feed_load_failed");
      });
    return () => {
      alive = false;
    };
  }, [client]);

  // Placeholder cards: the non-live styled tiles from the prototype (drafts / outlines), shown after the
  // real published series so the grid still reads like the prototype before those titles are authored.
  const placeholders = LIBRARY_CARDS.filter((c) => c.publish !== "live");

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
          onClick={() => onOpenSeries(feed[0]?.id)}
          disabled={feed.length === 0}
          data-testid="new-episode"
        >
          + New episode
        </button>
      </div>

      {error && (
        <p className="statusline err" role="alert" data-testid="library-error">
          Could not load the library: {error}
        </p>
      )}

      <div className="libgrid" data-testid="library-grid">
        {feed.map((s) => (
          <button
            key={s.id}
            type="button"
            className="lib"
            onClick={() => onOpenSeries(s.id)}
            data-testid="library-card-live"
            aria-label={`${s.title} (live)`}
          >
            <div
              className={`ph ${s.poster_url ? "" : "gp"}`}
              data-testid="library-poster-live"
              data-poster-url={s.poster_url ?? ""}
              style={s.poster_url ? { backgroundImage: `url(${s.poster_url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            />
            <div className="b">
              <div className="t">{s.title}</div>
              <div className="s">
                <span className="pub live">LIVE</span>
                {s.genre ? <span>{s.genre}</span> : null}
              </div>
            </div>
          </button>
        ))}

        {feed.length === 0 && !error && (
          <div className="muted" data-testid="library-empty" style={{ padding: 12 }}>
            No published series yet. Publish one to see it here.
          </div>
        )}

        {placeholders.map((card) => (
          <button
            key={card.title}
            type="button"
            className="lib"
            disabled
            data-testid={`library-card-${card.publish}`}
            aria-label={`${card.title} (${card.publish})`}
          >
            <div className={`ph ${card.gradientClass}`} />
            <div className="b">
              <div className="t">{card.title}</div>
              <div className="s">
                <span className="pub draft">{card.publish === "draft" ? "DRAFT" : "OUTLINE"}</span>
                {card.subtitle ? <span>{card.subtitle}</span> : null}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="note">
        <span className="notetag">FILLS THE GAP</span>
        The content upload tool that did not exist. It lists the real published series from the content
        graph the player reads from.
      </div>
    </div>
  );
}
