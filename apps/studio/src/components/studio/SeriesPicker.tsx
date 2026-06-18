// A series picker shared by the Upload and Process sections. It reads ALL series the creator owns via the
// content client (GET /series, drafts included), so a freshly created or still-unpublished series is
// selectable here even though it is not on the public /feed yet. Real loading / empty / error states, never
// a dead end. On select it hands the series id up; the parent loads the flattened graph.
//
// When `manage` is set (the Upload journey), the picker also lets the creator CREATE a new series inline and
// RENAME the selected one (PATCH /series/{id}). Built on the @axessplayer/ui STUDIO skin. WCAG AA. No em dashes.
import { useEffect, useState } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import type { SeriesRow } from "../../api/contractGap.js";

export interface SeriesPickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  // Heading copy so each host section can frame the choice in its own words.
  label?: string;
  // When true, show the "New series" and "Rename" affordances (the Upload journey owns content authoring).
  manage?: boolean;
  // Fired after a series is created or renamed, so a host can refresh dependent views. Optional.
  onChanged?: (series: SeriesRow) => void;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; series: SeriesRow[] };

function isDraft(s: SeriesRow): boolean {
  return s.published_at == null;
}

export function SeriesPicker({
  selectedId,
  onSelect,
  label = "Choose a series",
  manage = false,
  onChanged,
}: SeriesPickerProps): JSX.Element {
  const client = useContentClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);

  // Inline create + rename UI state. Kept local so the picker is self-contained.
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    client
      .listAllSeries()
      .then((series) => {
        if (alive) setState({ status: "loaded", series });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", message: e instanceof Error ? e.message : "series_load_failed" });
      });
    return () => {
      alive = false;
    };
  }, [client, reload]);

  const selected =
    state.status === "loaded" ? state.series.find((s) => s.id === selectedId) ?? null : null;

  const errMessage = (e: unknown): string =>
    e instanceof ContentApiError ? e.apiError ?? `content_error_${e.status}` : e instanceof Error ? e.message : "failed";

  const submitCreate = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const row = await client.createSeries({ title });
      setState((prev) =>
        prev.status === "loaded" ? { status: "loaded", series: [row, ...prev.series] } : prev,
      );
      setCreating(false);
      setNewTitle("");
      onSelect(row.id);
      onChanged?.(row);
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const title = renameTitle.trim();
    if (!title || !selectedId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const row = await client.updateSeries(selectedId, { title });
      setState((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", series: prev.series.map((s) => (s.id === row.id ? row : s)) }
          : prev,
      );
      setRenaming(false);
      onChanged?.(row);
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

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

  // Empty state: with `manage` the creator can make the first series right here; without it, point them on.
  const empty = state.series.length === 0;

  return (
    <div className="fld">
      <label htmlFor="series-picker">{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          id="series-picker"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          data-testid="series-picker"
          disabled={empty}
          style={{ flex: "1 1 240px" }}
        >
          <option value="">{empty ? "No series yet" : "Select a series"}</option>
          {state.series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {isDraft(s) ? " (draft)" : ""}
            </option>
          ))}
        </select>

        {manage && !creating && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCreating(true);
              setRenaming(false);
              setActionError(null);
            }}
            data-testid="series-create-open"
          >
            New series
          </button>
        )}
        {manage && !renaming && !creating && selected && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRenaming(true);
              setRenameTitle(selected.title);
              setActionError(null);
            }}
            data-testid="series-rename-open"
          >
            Rename
          </button>
        )}
      </div>

      {manage && creating && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }} data-testid="series-create-form">
          <input
            type="text"
            value={newTitle}
            placeholder="New series title"
            aria-label="New series title"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            autoFocus
            style={{ flex: "1 1 240px" }}
            data-testid="series-create-title"
          />
          <button type="button" className="btn primary" disabled={busy || newTitle.trim().length === 0} onClick={() => void submitCreate()} data-testid="series-create-submit">
            {busy ? "Creating..." : "Create"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      {manage && renaming && selected && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }} data-testid="series-rename-form">
          <input
            type="text"
            value={renameTitle}
            aria-label="Series title"
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            style={{ flex: "1 1 240px" }}
            data-testid="series-rename-title"
          />
          <button type="button" className="btn primary" disabled={busy || renameTitle.trim().length === 0} onClick={() => void submitRename()} data-testid="series-rename-submit">
            {busy ? "Saving..." : "Save name"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </div>
      )}

      {actionError && (
        <p className="statusline err" role="alert" data-testid="series-action-error" style={{ marginTop: 8 }}>
          {actionError}
        </p>
      )}
    </div>
  );
}
