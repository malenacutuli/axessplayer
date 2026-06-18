// A small series picker shared by the Upload and Process sections. It reads the real published catalog via
// the existing content client (GET /feed), so the creator chooses a real series instead of a hardcoded id.
// Real loading / empty / error states, never a dead end. On select it hands the series id up; the parent
// loads the flattened graph. Built on the @axessplayer/ui STUDIO skin. No em dashes.
import { useEffect, useState } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import type { FeedSeries } from "../../api/client.js";

export interface SeriesPickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  // Heading copy so each host section can frame the choice in its own words.
  label?: string;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; feed: FeedSeries[] };

export function SeriesPicker({ selectedId, onSelect, label = "Choose a series" }: SeriesPickerProps): JSX.Element {
  const client = useContentClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    client
      .getFeed()
      .then((feed) => {
        if (alive) setState({ status: "loaded", feed });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", message: e instanceof Error ? e.message : "feed_load_failed" });
      });
    return () => {
      alive = false;
    };
  }, [client, reload]);

  if (state.status === "loading") {
    return (
      <p className="muted" data-testid="series-picker-loading">
        Loading your series...
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="statusline err" role="alert" data-testid="series-picker-error">
        Could not load your series: {state.message}
        <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setReload((n) => n + 1)} data-testid="series-picker-retry">
          Retry
        </button>
      </div>
    );
  }
  if (state.feed.length === 0) {
    return (
      <p className="muted" data-testid="series-picker-empty">
        No series yet. Create one in Create with AI, then come back here.
      </p>
    );
  }

  return (
    <div className="fld">
      <label htmlFor="series-picker">{label}</label>
      <select
        id="series-picker"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        data-testid="series-picker"
      >
        <option value="">Select a series</option>
        {state.feed.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
            {s.published_at ? "" : " (draft)"}
          </option>
        ))}
      </select>
    </div>
  );
}
