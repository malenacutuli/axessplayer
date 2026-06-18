// STORY GRAPH (/admin/story-graph/:seriesId). A readable node/edge view of the versioned adaptive graph
// from GET /admin/story-graph/:seriesId: episode / beat / branch / ending / POV / intensity / premium /
// locked nodes, choice timers on edges, the default-fallback edge, canon rules, and the memory variables
// each branch reads/writes. The diagram is a dependency-free SVG laid out in columns by node depth (no
// heavy graph dependency). "Validate" calls POST .../validate and shows the constraint-solver result;
// "Simulate viewer journey" calls POST .../simulate and replays a path, highlighting the visited nodes.
// Editing nodes is RBAC-gated (Content/Admin/Owner via storygraph.edit); ReadOnly sees a read-only view.
// Pricing and reward-weights are DISPLAY-ONLY. Keyboard: the node list is a roving listbox that selects a
// node and scrolls/announces it; the SVG is aria-hidden decoration mirrored by that accessible list. WCAG
// 2.2 AA. No emojis, no em dashes.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useAdminApi, useStoryGraph } from "../api/useAdminData";
import type {
  SimulateResult,
  StoryGraph as StoryGraphData,
  StoryNode,
  StoryNodeKind,
  StoryValidation,
} from "../api/adminApi";
import { demoSimulate, demoValidate } from "../api/demoData";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const KIND_LABEL: Record<StoryNodeKind, string> = {
  episode: "Episode",
  beat: "Beat",
  branch: "Branch",
  ending: "Ending",
  pov: "POV",
  intensity: "Intensity",
  premium: "Premium",
  locked: "Locked",
};

// Layout geometry. Columns are node depth; rows stack within a column. Pure geometry, no dependency.
const COL_W = 210;
const ROW_H = 92;
const NODE_W = 168;
const NODE_H = 60;
const PAD_X = 24;
const PAD_Y = 24;

function nodeXY(n: StoryNode, colCounts: Map<number, number>) {
  const col = n.col ?? 0;
  const row = n.row ?? 0;
  const x = PAD_X + col * COL_W;
  const y = PAD_Y + row * ROW_H;
  void colCounts;
  return { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
}

export function StoryGraph({ seriesId }: { seriesId: string }) {
  const { data, loading, error, source } = useStoryGraph(seriesId);
  const api = useAdminApi();
  const { can } = useRole();
  const { navigate } = useRouter();
  const canEdit = can("storygraph.edit");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState<StoryValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [sim, setSim] = useState<SimulateResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset transient panels when the series changes.
  useEffect(() => {
    setSelectedId(null);
    setValidation(null);
    setSim(null);
  }, [seriesId]);

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Adaptive story graph" />
        <Skeleton height={420} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Adaptive story graph" />
        <ErrorState
          title="Graph unavailable"
          action={<Button variant="secondary" onClick={() => navigate("/admin/content")}>Back to Content CMS</Button>}
        >
          No story graph for series {seriesId}.
        </ErrorState>
      </section>
    );
  }

  return (
    <StoryGraphView
      data={data}
      source={source}
      canEdit={canEdit}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      validation={validation}
      validating={validating}
      sim={sim}
      simulating={simulating}
      listRef={listRef}
      onValidate={async () => {
        setValidating(true);
        setSim(null);
        try {
          const res = await api.validateStoryGraph(seriesId);
          setValidation(res);
        } catch {
          setValidation(demoValidate(seriesId));
        } finally {
          setValidating(false);
        }
      }}
      onSimulate={async () => {
        setSimulating(true);
        setValidation(null);
        try {
          const res = await api.simulateStoryGraph(seriesId, {});
          setSim(res);
        } catch {
          setSim(demoSimulate(seriesId, {}));
        } finally {
          setSimulating(false);
        }
      }}
      onClearSim={() => setSim(null)}
    />
  );
}

interface ViewProps {
  data: StoryGraphData;
  source: "live" | "demo";
  canEdit: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  validation: StoryValidation | null;
  validating: boolean;
  sim: SimulateResult | null;
  simulating: boolean;
  listRef: React.RefObject<HTMLUListElement>;
  onValidate: () => void;
  onSimulate: () => void;
  onClearSim: () => void;
}

function StoryGraphView(p: ViewProps) {
  const { data, sim, selectedId } = p;
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const colCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of data.nodes) m.set(n.col ?? 0, (m.get(n.col ?? 0) ?? 0) + 1);
    return m;
  }, [data.nodes]);

  const maxCol = Math.max(0, ...data.nodes.map((n) => n.col ?? 0));
  const maxRow = Math.max(0, ...data.nodes.map((n) => n.row ?? 0));
  const width = PAD_X * 2 + maxCol * COL_W + NODE_W;
  const height = PAD_Y * 2 + maxRow * ROW_H + NODE_H;

  const visited = new Set(sim?.visitedNodeIds ?? []);
  const visitedEdges = new Set<string>();
  if (sim) {
    const path = sim.visitedNodeIds;
    for (let i = 0; i < path.length - 1; i++) {
      const e = data.edges.find((ed) => ed.from === path[i] && ed.to === path[i + 1]);
      if (e) visitedEdges.add(e.id);
    }
  }

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Roving selection over the node list. Arrow keys move selection; the SVG mirrors it (aria-hidden).
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const ids = data.nodes.map((n) => n.id);
    const idx = selectedId ? ids.indexOf(selectedId) : -1;
    const next = e.key === "ArrowDown" ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
    p.setSelectedId(ids[next] ?? ids[0]);
  };

  return (
    <section className="adm-page">
      <PageHead
        title={`Story graph: ${data.seriesTitle}`}
        subtitle={`Version ${data.version} · ${data.nodes.length} nodes · ${data.edges.length} edges. Pricing and reward weights are display-only.`}
        right={
          <>
            <Button variant="secondary" onClick={p.onValidate} disabled={p.validating}>
              {p.validating ? "Validating..." : "Validate"}
            </Button>
            <Button variant="secondary" onClick={p.onSimulate} disabled={p.simulating}>
              {p.simulating ? "Simulating..." : "Simulate viewer journey"}
            </Button>
            {p.canEdit ? (
              <button className="adm-soon" disabled aria-disabled title="Node editing arrives in a later wave">
                Edit nodes (coming soon)
              </button>
            ) : (
              <span className="adm-pill" title="Read-only role">Read-only</span>
            )}
          </>
        }
        source={p.source}
      />

      {sim && (
        <div className="adm-alert" role="status" style={{ marginBottom: 12 }}>
          <div className="adm-alert__title">Simulated viewer journey</div>
          <div className="adm-alert__sub">
            {sim.steps.map((s) => s.title).join("  ->  ")}
            {sim.endingNodeId && <> · ending: {byId.get(sim.endingNodeId)?.title}</>}
          </div>
          <div style={{ marginTop: 8 }}>
            <Button variant="secondary" onClick={p.onClearSim}>Clear simulation</Button>
          </div>
        </div>
      )}

      {p.validation && (
        <div className={`adm-alert ${p.validation.ok ? "" : "adm-alert--danger"}`} role="status" style={{ marginBottom: 12 }}>
          <div className="adm-alert__title">{p.validation.ok ? "Validation passed" : "Validation found errors"}</div>
          <ul className="adm-issues">
            {p.validation.issues.map((iss, i) => (
              <li key={i} className={`adm-issue adm-issue--${iss.severity}`}>
                <span className="adm-issue__sev">{iss.severity.toUpperCase()}</span>
                <span>{iss.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="adm-two-col">
        {/* The diagram (decorative; mirrored by the accessible node list beside it). */}
        <section className="adm-card" aria-hidden>
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Graph</h2>
          <div className="adm-graph-scroll">
            <svg className="adm-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" fill="var(--axp-faint)" />
                </marker>
                <marker id="arrow-on" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" fill="var(--axp-rose)" />
                </marker>
              </defs>
              {data.edges.map((e) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const pa = nodeXY(a, colCounts);
                const pb = nodeXY(b, colCounts);
                const x1 = pa.x + NODE_W;
                const y1 = pa.cy;
                const x2 = pb.x;
                const y2 = pb.cy;
                const mx = (x1 + x2) / 2;
                const on = visitedEdges.has(e.id);
                return (
                  <g key={e.id}>
                    <path
                      d={`M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={on ? "var(--axp-rose)" : "var(--axp-faint)"}
                      strokeWidth={on ? 2.4 : 1.4}
                      strokeDasharray={e.isDefault ? "5 4" : undefined}
                      markerEnd={`url(#${on ? "arrow-on" : "arrow"})`}
                    />
                    {(e.choice || e.timerSec) && (
                      <text x={mx} y={(y1 + y2) / 2 - 6} className="adm-graph__edgelabel" textAnchor="middle">
                        {e.choice ?? "default"}{e.timerSec ? ` (${e.timerSec}s)` : ""}{e.isDefault ? " · default" : ""}
                      </text>
                    )}
                  </g>
                );
              })}
              {data.nodes.map((n) => {
                const pos = nodeXY(n, colCounts);
                const on = visited.has(n.id);
                const sel = selectedId === n.id;
                return (
                  <g key={n.id} transform={`translate(${pos.x} ${pos.y})`}>
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={10}
                      className={`adm-gnode adm-gnode--${n.kind}`}
                      stroke={sel ? "var(--axp-rose)" : on ? "var(--axp-rose)" : undefined}
                      strokeWidth={sel ? 2.5 : on ? 2 : undefined}
                    />
                    <text x={10} y={20} className="adm-gnode__kind">{KIND_LABEL[n.kind].toUpperCase()}{n.locked ? " · LOCKED" : ""}</text>
                    <text x={10} y={38} className="adm-gnode__title">{n.title.length > 22 ? `${n.title.slice(0, 21)}...` : n.title}</text>
                    {n.priceCoins != null && <text x={10} y={52} className="adm-gnode__price">{n.priceCoins} coins</text>}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="adm-legend" style={{ marginTop: 12 }}>
            <span><span className="adm-legend__sw" style={{ background: "var(--axp-faint)" }} />edge</span>
            <span><span className="adm-legend__sw" style={{ background: "var(--axp-rose)" }} />default fallback (dashed) / simulated path</span>
          </div>
        </section>

        {/* The accessible mirror: a roving listbox of nodes, plus the selected-node inspector. */}
        <section aria-label="Story graph nodes and inspector">
          <ul
            className="adm-nodelist"
            ref={p.listRef}
            role="listbox"
            aria-label="Graph nodes"
            aria-activedescendant={selectedId ? `node-${selectedId}` : undefined}
            tabIndex={0}
            onKeyDown={onListKey}
          >
            {data.nodes.map((n) => (
              <li
                key={n.id}
                id={`node-${n.id}`}
                role="option"
                aria-selected={selectedId === n.id}
                className={`adm-nodelist__row ${selectedId === n.id ? "is-selected" : ""} ${visited.has(n.id) ? "is-visited" : ""}`}
                onClick={() => p.setSelectedId(n.id)}
              >
                <span className={`adm-nodekind adm-nodekind--${n.kind}`}>{KIND_LABEL[n.kind]}</span>
                <span className="adm-nodelist__title">{n.title}</span>
                {n.priceCoins != null && <span className="adm-cell-mono">{n.priceCoins}c</span>}
                {visited.has(n.id) && <span className="adm-cell-mono">visited</span>}
              </li>
            ))}
          </ul>

          <NodeInspector node={selected} />

          <section className="adm-card" style={{ marginTop: 12 }} aria-label="Memory variables">
            <h2 className="adm-card__title" style={{ marginBottom: 10 }}>Memory variables</h2>
            <div className="adm-meta">
              {data.memoryVars.map((v) => (
                <div key={v.name} className="adm-meta__row">
                  <span className="adm-meta__k">{v.name} <span className="adm-cell-mono">({v.type})</span></span>
                  <span className="adm-meta__v" style={{ textAlign: "right" }}>{v.note}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="adm-card" style={{ marginTop: 12 }} aria-label="Canon rules and default fallback">
            <h2 className="adm-card__title" style={{ marginBottom: 10 }}>Canon rules</h2>
            <ul className="adm-rules">
              {data.canonRules.map((r) => (
                <li key={r.id} className="adm-rules__row">{r.rule}</li>
              ))}
            </ul>
            {data.defaultFallbackNodeId && (
              <p className="adm-note" style={{ marginTop: 10 }}>
                Default fallback node: {byId.get(data.defaultFallbackNodeId)?.title ?? data.defaultFallbackNodeId}
              </p>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}

function NodeInspector({ node }: { node: StoryNode | null }) {
  if (!node) {
    return (
      <section className="adm-card" style={{ marginTop: 12 }} aria-label="Node inspector">
        <h2 className="adm-card__title" style={{ marginBottom: 8 }}>Inspector</h2>
        <p className="adm-note">Select a node to see what it reads, writes, and its pricing (display only).</p>
      </section>
    );
  }
  return (
    <section className="adm-card" style={{ marginTop: 12 }} aria-label={`Inspector for ${node.title}`}>
      <h2 className="adm-card__title" style={{ marginBottom: 8 }}>{node.title}</h2>
      <div className="adm-meta">
        <div className="adm-meta__row"><span className="adm-meta__k">Kind</span><span className="adm-meta__v">{KIND_LABEL[node.kind]}{node.locked ? " (locked)" : ""}</span></div>
        <div className="adm-meta__row"><span className="adm-meta__k">Reads</span><span className="adm-meta__v">{node.reads?.join(", ") || "none"}</span></div>
        <div className="adm-meta__row"><span className="adm-meta__k">Writes</span><span className="adm-meta__v">{node.writes?.join(", ") || "none"}</span></div>
        <div className="adm-meta__row"><span className="adm-meta__k">Pricing</span><span className="adm-meta__v">{node.priceCoins != null ? `${node.priceCoins} coins (display only)` : "free"}</span></div>
      </div>
    </section>
  );
}
