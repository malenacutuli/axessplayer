// Branch editor panel: the canvas with positioned beat nodes connected by SVG edges, read from the real
// flattened graph. Selecting a node highlights it (rose ring) and is the selection the Media and Pricing
// panels act on. Below the canvas, lightweight create forms POST a beat or an edge to the content service
// and bump the reload token so the canvas refreshes. No em dashes.
import { useState, type FormEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import { layoutGraph } from "../../api/graphLayout.js";
import { BEAT_ROLES, type BeatRole } from "../../api/contractGap.js";
import { brokenEdges, serializeInterchange } from "../../api/graphInterchange.js";
import type { FlatGraph } from "../../api/flattenGraph.js";

export interface BranchEditorPanelProps {
  seriesId: string;
  graph: FlatGraph;
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
  onCreated: () => void;
  onGoToMedia: () => void;
}

export function BranchEditorPanel({
  seriesId,
  graph,
  selectedBeatId,
  onSelectBeat,
  onCreated,
  onGoToMedia,
}: BranchEditorPanelProps): JSX.Element {
  const layout = layoutGraph(graph);
  const ep = graph.beats[0];
  const epLabel = ep
    ? `${graph.seriesTitle} - Ep ${ep.episode_number}`
    : graph.seriesTitle;
  const broken = brokenEdges(graph);

  // Twine's "plain interchange is a feature": download the authored graph as canonical, diffable JSON.
  const exportGraph = () => {
    try {
      const json = serializeInterchange(graph);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${graph.seriesTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "story"}.story-graph.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable in this environment */
    }
  };

  return (
    <div className="spanel" data-testid="panel-branch">
      <div className="sbar">
        <div>
          <div className="ey rose">{epLabel}</div>
          <h2 style={{ marginTop: 8 }}>Branch editor</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" onClick={exportGraph} data-testid="export-graph">
            Export graph
          </button>
          <button type="button" className="btn pri" onClick={onGoToMedia} data-testid="goto-media">
            Upload variants →
          </button>
        </div>
      </div>
      {broken.length > 0 ? (
        <p className="statusline err" role="alert" data-testid="broken-edges">
          {broken.length} broken edge{broken.length === 1 ? "" : "s"} point at a missing beat.
        </p>
      ) : null}

      <div
        className="canvas"
        data-testid="branch-canvas"
        style={{ height: Math.max(layout.height + 20, 330) }}
      >
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="none"
        >
          {layout.edges.map((e) => (
            <path
              key={e.id}
              d={e.path}
              fill="none"
              strokeWidth={2}
              stroke={
                e.kind === "fork"
                  ? "var(--rose)"
                  : e.kind === "premium"
                    ? "var(--gold)"
                    : "#D5D5DC"
              }
              strokeDasharray={e.kind === "premium" ? "5 4" : undefined}
              data-testid={`edge-${e.kind}`}
            />
          ))}
        </svg>

        {layout.nodes.map((n) => {
          const selected = n.beat.id === selectedBeatId;
          const cls = `gnode${n.isPremium ? " prem" : ""}${selected ? " sel" : ""}`;
          return (
            <button
              key={n.beat.id}
              type="button"
              className={cls}
              style={{ left: n.x, top: n.y }}
              onClick={() => onSelectBeat(n.beat.id)}
              data-testid={`gnode-${n.beat.id}`}
              data-selected={selected ? "true" : "false"}
              aria-pressed={selected}
            >
              <div className="k">{n.kicker}</div>
              <div className="nm">{n.name}</div>
              {n.isPremium && n.premiumCoinCost != null ? (
                <div className="pc">◆ {n.premiumCoinCost} coins</div>
              ) : (
                <div className="v">{n.detail}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="help">
        Rose path = the per-viewer fork the decision engine chooses. Gold dashed = premium, coin-gated. Both
        branches reconverge on the shared ending, so the next chapter is branch-independent.
      </div>

      <div className="formgrid">
        <AddBeatForm seriesId={seriesId} graph={graph} onCreated={onCreated} />
        <AddEdgeForm graph={graph} onCreated={onCreated} />
      </div>
    </div>
  );
}

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

function useSubmit(): { status: Status; run: (fn: () => Promise<string>) => Promise<string | null> } {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const run = async (fn: () => Promise<string>) => {
    setStatus({ state: "submitting" });
    try {
      const id = await fn();
      setStatus({ state: "ok", message: id });
      return id;
    } catch (e) {
      const message =
        e instanceof ContentApiError
          ? (e.apiError ?? `error_${e.status}`)
          : e instanceof Error
            ? e.message
            : "request_failed";
      setStatus({ state: "error", message });
      return null;
    }
  };
  return { status, run };
}

function StatusLine({ status, testid }: { status: Status; testid: string }): JSX.Element | null {
  if (status.state === "ok") {
    return (
      <p className="statusline ok" role="status" data-testid={`${testid}-ok`}>
        Created {status.message}
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <p className="statusline err" role="alert" data-testid={`${testid}-error`}>
        Error: {status.message}
      </p>
    );
  }
  return null;
}

function AddBeatForm({
  seriesId,
  graph,
  onCreated,
}: {
  seriesId: string;
  graph: FlatGraph;
  onCreated: () => void;
}): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  // The episode comes from the loaded graph; in the seed there is one episode.
  const episodeId = graph.beats[0]?.episode_id ?? "";
  const [beatIndex, setBeatIndex] = useState("0");
  const [role, setRole] = useState<BeatRole>("spine");
  const [isBranchPoint, setIsBranchPoint] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await run(async () =>
      (
        await client.createBeat({
          series_id: seriesId,
          episode_id: episodeId,
          beat_index: Number.parseInt(beatIndex, 10) || 0,
          role,
          is_branch_point: isBranchPoint,
        })
      ).id,
    );
    if (id) onCreated();
  };

  return (
    <form className="subtle" onSubmit={onSubmit} aria-label="Add beat" data-testid="form-beat">
      <h3>Add a beat</h3>
      <div className="fld">
        <label htmlFor="beat-index">Beat index</label>
        <input
          id="beat-index"
          type="number"
          value={beatIndex}
          onChange={(e) => setBeatIndex(e.target.value)}
        />
      </div>
      <div className="fld">
        <label htmlFor="beat-role">Role</label>
        <select id="beat-role" value={role} onChange={(e) => setRole(e.target.value as BeatRole)}>
          {BEAT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <label className="toggle2" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={isBranchPoint}
          onChange={(e) => setIsBranchPoint(e.target.checked)}
        />
        Branch point
      </label>
      <div className="rowend">
        <button
          type="submit"
          className="btn"
          disabled={status.state === "submitting" || !episodeId}
        >
          Add beat
        </button>
      </div>
      <StatusLine status={status} testid="form-beat" />
    </form>
  );
}

function AddEdgeForm({ graph, onCreated }: { graph: FlatGraph; onCreated: () => void }): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [fromBeatId, setFromBeatId] = useState("");
  const [toBeatId, setToBeatId] = useState("");

  const beatOptions = graph.beats.map((b) => ({
    id: b.id,
    label: `#${b.beat_index} ${b.role}${b.is_branch_point ? " (branch)" : ""}`,
  }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await run(async () => {
      const row = await client.createEdge({ from_beat_id: fromBeatId, to_beat_id: toBeatId });
      return `${row.from_beat_id}->${row.to_beat_id}`;
    });
    if (id) onCreated();
  };

  return (
    <form className="subtle" onSubmit={onSubmit} aria-label="Connect beats" data-testid="form-edge">
      <h3>Connect beats</h3>
      <div className="fld">
        <label htmlFor="edge-from">From beat</label>
        <select
          id="edge-from"
          value={fromBeatId}
          onChange={(e) => setFromBeatId(e.target.value)}
          required
        >
          <option value="">Select beat</option>
          {beatOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label htmlFor="edge-to">To beat</label>
        <select id="edge-to" value={toBeatId} onChange={(e) => setToBeatId(e.target.value)} required>
          <option value="">Select beat</option>
          {beatOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="rowend">
        <button
          type="submit"
          className="btn"
          disabled={status.state === "submitting" || !fromBeatId || !toBeatId}
        >
          Connect
        </button>
      </div>
      <StatusLine status={status} testid="form-edge" />
    </form>
  );
}
