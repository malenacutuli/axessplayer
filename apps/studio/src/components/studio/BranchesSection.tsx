// SECTION 8 - BRANCH & ENDINGS (/studio/branches). The branch-graph editor read from the catalog
// GET /series/:id/graph.
//   - SIMPLE mode (default): a linear timeline of the default path, with off-spine offshoots per step.
//   - PRO toggle (data-pro-only): the full node/edge graph as a dependency-free SVG diagram MIRRORED by an
//     accessible roving listbox (same approach as the admin story-graph), plus a node inspector.
//   - Broken-link detection + canon-constraint validation shown INLINE; publishing an invalid graph is
//     BLOCKED and the reason is shown clearly.
//   - Alternate endings + alt-POV + intensity premium cuts are MERCHANDISED purchasable variants with their
//     own creator-set coin price (upload or AI-generate entry points; AI-generate is the unwired state).
//   - The memory variables a branch reads / writes are shown in the inspector and a summary card.
// The catalog routes may not be deployed in every environment: a 404 renders a graceful empty state, never a
// dead end. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No emojis, no em dashes.
import { useMemo, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, Skeleton } from "@axessplayer/ui";
import { SeriesPicker } from "./SeriesPicker.js";
import { useSeriesGraphView } from "../../api/useCatalog.js";
import {
  brokenLinks,
  layoutColumns,
  linearTimeline,
  publishReadiness,
} from "../../api/catalogGraph.js";
import type { GraphNode, GraphNodeKind, SeriesGraphView } from "../../api/catalogTypes.js";

const KIND_LABEL: Record<GraphNodeKind, string> = {
  beat: "Beat",
  branch: "Branch",
  ending: "Ending",
  pov: "POV",
  intensity: "Intensity",
  premium: "Premium",
  locked: "Locked",
};

// Variant kinds that are MERCHANDISED as purchasable premium cuts.
const PURCHASABLE: ReadonlySet<GraphNodeKind> = new Set<GraphNodeKind>(["pov", "intensity", "premium"]);

export interface BranchesSectionProps {
  proMode: boolean;
}

export function BranchesSection({ proMode }: BranchesSectionProps): JSX.Element {
  const [seriesId, setSeriesId] = useState("");
  const [reload, setReload] = useState(0);
  const state = useSeriesGraphView(seriesId, reload);

  return (
    <div className="spanel" data-testid="panel-branches">
      <div className="sbar">
        <div>
          <div className="ey rose">Branch and endings</div>
          <h2 style={{ marginTop: 8 }}>Story graph editor</h2>
        </div>
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Choose a series to edit" />

      {!seriesId && (
        <p className="muted" data-testid="branches-idle" style={{ marginTop: 12 }}>
          Pick a series to open its branching story graph.
        </p>
      )}

      {seriesId && state.status === "loading" && (
        <div data-testid="branches-loading" style={{ marginTop: 12 }} aria-busy="true">
          <Skeleton height={48} />
          <Skeleton height={220} style={{ marginTop: 10 }} />
        </div>
      )}

      {seriesId && state.status === "error" && state.notAvailable && (
        <EmptyState
          title="Graph editor is not connected here"
          action={
            <Button variant="secondary" data-testid="branches-retry" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          <p className="muted" data-testid="branches-not-available">
            The catalog graph service is not reachable in this environment yet. Authoring is available once it
            is connected.
          </p>
        </EmptyState>
      )}

      {seriesId && state.status === "error" && !state.notAvailable && (
        <ErrorState
          title="Could not load the graph"
          action={
            <Button variant="secondary" data-testid="branches-retry" onClick={() => setReload((n) => n + 1)}>
              Retry
            </Button>
          }
        >
          <p className="muted" data-testid="branches-error">
            {state.message}
          </p>
        </ErrorState>
      )}

      {seriesId && state.status === "loaded" && <GraphEditor view={state.data} proMode={proMode} />}
    </div>
  );
}

function GraphEditor({ view, proMode }: { view: SeriesGraphView; proMode: boolean }): JSX.Element {
  const readiness = useMemo(() => publishReadiness(view), [view]);
  const links = useMemo(() => brokenLinks(view), [view]);
  const [selectedId, setSelectedId] = useState<string | null>(view.nodes[0]?.id ?? null);
  const selected = selectedId ? view.nodes.find((n) => n.id === selectedId) ?? null : null;

  return (
    <div data-testid="branches-editor">
      {/* Inline validation banner: broken links + canon constraints. Publishing an invalid graph is blocked. */}
      <ValidationBanner readiness={readiness} brokenCount={links.length} />

      {proMode ? (
        <ProGraph view={view} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <SimpleTimeline view={view} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      <div className="insp" style={{ marginTop: 18 }}>
        <NodeInspector node={selected} />
        <MerchandiseCard node={selected} premiumFloor={view.pricing?.premiumFloor} />
      </div>

      <MemoryVarsCard view={view} />

      <div className="rowend" style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          data-testid="branches-publish"
          disabled={!readiness.publishable}
          aria-disabled={!readiness.publishable}
          title={readiness.publishable ? "Publish the graph" : "Fix the blockers above before publishing"}
        >
          Publish graph
        </Button>
        {!readiness.publishable && (
          <span className="muted" data-testid="branches-publish-blocked" style={{ marginLeft: 10 }}>
            Publishing is blocked until the {readiness.blockers.length} blocker
            {readiness.blockers.length === 1 ? "" : "s"} above are resolved.
          </span>
        )}
      </div>
    </div>
  );
}

function ValidationBanner({
  readiness,
  brokenCount,
}: {
  readiness: ReturnType<typeof publishReadiness>;
  brokenCount: number;
}): JSX.Element {
  if (readiness.publishable && readiness.warnings.length === 0) {
    return (
      <p className="statusline ok" role="status" data-testid="branches-valid" style={{ marginTop: 12 }}>
        Graph is valid. No broken links, canon constraints satisfied.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      {readiness.blockers.length > 0 && (
        <div role="alert" data-testid="branches-blockers">
          <p className="statusline err" data-testid="broken-links" style={{ marginBottom: 4 }}>
            {brokenCount > 0
              ? `${brokenCount} broken link${brokenCount === 1 ? "" : "s"} and `
              : ""}
            {readiness.blockers.length} issue{readiness.blockers.length === 1 ? "" : "s"} block publishing:
          </p>
          <ul className="adm-issues" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.blockers.map((b, i) => (
              <li key={i} className="statusline err" data-testid={`branches-blocker-${i}`}>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {readiness.warnings.length > 0 && (
        <ul className="adm-issues" data-testid="branches-warnings" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {readiness.warnings.map((w, i) => (
            <li key={i} className="muted" data-testid={`branches-warning-${i}`}>
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// SIMPLE MODE: a readable linear timeline of the default path, offshoots listed per step.
function SimpleTimeline({
  view,
  selectedId,
  onSelect,
}: {
  view: SeriesGraphView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const steps = useMemo(() => linearTimeline(view), [view]);
  return (
    <section data-testid="branches-timeline" aria-label="Story timeline (simple view)" style={{ marginTop: 14 }}>
      <div className="scaption">Timeline (default path)</div>
      <ol className="branch-timeline">
        {steps.map((s, i) => (
          <li key={s.node.id} className="branch-timeline__step">
            <button
              type="button"
              className={`branch-tl-node${selectedId === s.node.id ? " sel" : ""}`}
              onClick={() => onSelect(s.node.id)}
              aria-pressed={selectedId === s.node.id}
              data-testid={`tl-node-${s.node.id}`}
            >
              <span className="branch-tl-node__k">
                {i + 1}. {KIND_LABEL[s.node.kind]}
              </span>
              <span className="branch-tl-node__nm">{s.node.title}</span>
              {s.node.pricing && (
                <span className="branch-tl-node__pc">{s.node.pricing.priceCoins} coins</span>
              )}
            </button>
            {s.offshoots.length > 0 && (
              <ul className="branch-timeline__offshoots">
                {s.offshoots.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`branch-offshoot${selectedId === o.id ? " sel" : ""}`}
                      onClick={() => onSelect(o.id)}
                      aria-pressed={selectedId === o.id}
                      data-testid={`tl-offshoot-${o.id}`}
                    >
                      {KIND_LABEL[o.kind]}: {o.title}
                      {o.pricing ? ` (${o.pricing.priceCoins} coins)` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// PRO MODE: the full node/edge SVG diagram (aria-hidden decoration) mirrored by an accessible roving listbox.
const COL_W = 200;
const ROW_H = 88;
const NODE_W = 160;
const NODE_H = 58;
const PAD = 22;

function ProGraph({
  view,
  selectedId,
  onSelect,
}: {
  view: SeriesGraphView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  const layout = useMemo(() => layoutColumns(view), [view]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const width = PAD * 2 + layout.maxCol * COL_W + NODE_W;
  const height = PAD * 2 + layout.maxRow * ROW_H + NODE_H;

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const ids = view.nodes.map((n) => n.id);
    const idx = selectedId ? ids.indexOf(selectedId) : -1;
    const next = e.key === "ArrowDown" ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
    onSelect(ids[next] ?? ids[0]);
  };

  return (
    <section data-testid="branches-pro" data-pro-only="true" aria-label="Story graph (pro view)" style={{ marginTop: 14 }}>
      <div className="branch-pro-grid">
        {/* The diagram: decorative, mirrored by the accessible node list. */}
        <div className="branch-graph-scroll" aria-hidden>
          <svg
            className="branch-graph"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="presentation"
            data-testid="branches-svg"
          >
            <defs>
              <marker id="bg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="#c9c9d4" />
              </marker>
            </defs>
            {view.edges.map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const x1 = PAD + a.col * COL_W + NODE_W;
              const y1 = PAD + a.row * ROW_H + NODE_H / 2;
              const x2 = PAD + b.col * COL_W;
              const y2 = PAD + b.row * ROW_H + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#c9c9d4"
                  strokeWidth={1.6}
                  strokeDasharray={e.isDefault ? undefined : "5 4"}
                  markerEnd="url(#bg-arrow)"
                />
              );
            })}
            {layout.nodes.map((n) => {
              const x = PAD + n.col * COL_W;
              const y = PAD + n.row * ROW_H;
              const sel = selectedId === n.id;
              return (
                <g key={n.id} transform={`translate(${x} ${y})`}>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    fill="#fff"
                    stroke={sel ? "var(--rose)" : PURCHASABLE.has(n.kind) ? "#eedfb6" : "#e3e3ea"}
                    strokeWidth={sel ? 2.5 : 1.4}
                  />
                  <text x={10} y={20} style={{ fontSize: 10, fill: "var(--mut)" }}>
                    {KIND_LABEL[n.kind].toUpperCase()}
                    {n.locked ? " - LOCKED" : ""}
                  </text>
                  <text x={10} y={38} style={{ fontSize: 12, fontWeight: 600 }}>
                    {n.title.length > 20 ? `${n.title.slice(0, 19)}...` : n.title}
                  </text>
                  {n.pricing && (
                    <text x={10} y={52} style={{ fontSize: 10.5, fill: "var(--rose)" }}>
                      {n.pricing.priceCoins} coins
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* The accessible mirror: a roving listbox of the same nodes. */}
        <ul
          className="branch-nodelist"
          ref={listRef}
          role="listbox"
          aria-label="Graph nodes"
          aria-activedescendant={selectedId ? `bnode-${selectedId}` : undefined}
          tabIndex={0}
          onKeyDown={onListKey}
          data-testid="branches-nodelist"
        >
          {view.nodes.map((n) => (
            <li
              key={n.id}
              id={`bnode-${n.id}`}
              role="option"
              aria-selected={selectedId === n.id}
              className={`branch-nodelist__row${selectedId === n.id ? " is-selected" : ""}`}
              onClick={() => onSelect(n.id)}
              data-testid={`branches-node-${n.id}`}
            >
              <span className="branch-nodekind">{KIND_LABEL[n.kind]}</span>
              <span className="branch-nodelist__title">{n.title}</span>
              {n.pricing && <span className="branch-cell-mono">{n.pricing.priceCoins}c</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NodeInspector({ node }: { node: GraphNode | null }): JSX.Element {
  if (!node) {
    return (
      <section className="inspcard" aria-label="Node inspector" data-testid="branches-inspector">
        <div className="scaption">Inspector</div>
        <p className="muted">Select a node to see what it reads, writes, and how it is merchandised.</p>
      </section>
    );
  }
  return (
    <section className="inspcard" aria-label={`Inspector for ${node.title}`} data-testid="branches-inspector">
      <div className="scaption">{KIND_LABEL[node.kind]}</div>
      <h3 style={{ margin: "0 0 8px" }}>{node.title}</h3>
      <div className="branch-meta">
        <div className="branch-meta__row">
          <span className="muted">Reads</span>
          <span data-testid="branches-reads">{node.reads && node.reads.length > 0 ? node.reads.join(", ") : "none"}</span>
        </div>
        <div className="branch-meta__row">
          <span className="muted">Writes</span>
          <span data-testid="branches-writes">{node.writes && node.writes.length > 0 ? node.writes.join(", ") : "none"}</span>
        </div>
        <div className="branch-meta__row">
          <span className="muted">Locked</span>
          <span>{node.locked ? "yes (coin / entitlement gate)" : "no"}</span>
        </div>
      </div>
    </section>
  );
}

// Merchandising: alt-ending / alt-POV / intensity premium cuts are purchasable, with a CREATOR-SET coin
// price (own-once, never a live Stripe rail) and an upload or AI-generate entry point. AI-generate is the
// unwired / coming-soon state.
function MerchandiseCard({ node, premiumFloor }: { node: GraphNode | null; premiumFloor?: number }): JSX.Element {
  const purchasable = node != null && PURCHASABLE.has(node.kind);
  const [price, setPrice] = useState<string>("");
  const effectivePrice = purchasable ? (price !== "" ? price : String(node?.pricing?.priceCoins ?? premiumFloor ?? 5)) : "";

  if (!node) {
    return (
      <section className="inspcard" aria-label="Merchandising" data-testid="branches-merch">
        <div className="scaption">Merchandising</div>
        <p className="muted">Select an alternate ending, alt-POV, or intensity cut to set its price.</p>
      </section>
    );
  }

  if (!purchasable) {
    return (
      <section className="inspcard" aria-label="Merchandising" data-testid="branches-merch">
        <div className="scaption">Merchandising</div>
        <p className="muted" data-testid="branches-merch-free">
          This is a spine beat or branch, included for every viewer. Premium cuts (alternate endings, alt-POV,
          intensity) are the purchasable variants.
        </p>
      </section>
    );
  }

  return (
    <section className="inspcard" aria-label={`Merchandising for ${node.title}`} data-testid="branches-merch">
      <div className="scaption">Premium cut - creator-set price</div>
      <div className="fld">
        <label htmlFor="merch-price">Price (coins, own-once)</label>
        <input
          id="merch-price"
          type="number"
          min={0}
          value={effectivePrice}
          onChange={(e) => setPrice(e.target.value)}
          data-testid="branches-merch-price"
          style={{ width: 110 }}
        />
      </div>
      <p className="muted" style={{ marginTop: 2 }} data-testid="branches-merch-rail">
        Coins are the only rail. There is no live card payment here.
      </p>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <Button variant="secondary" data-testid="branches-merch-upload">
          Upload master
        </Button>
        <button
          type="button"
          className="btn"
          disabled
          aria-disabled
          data-testid="branches-merch-ai"
          title="AI generation for premium cuts arrives in a later wave"
        >
          AI-generate (coming soon)
        </button>
      </div>
    </section>
  );
}

function MemoryVarsCard({ view }: { view: SeriesGraphView }): JSX.Element {
  return (
    <section className="inspcard" style={{ marginTop: 18 }} aria-label="Memory variables" data-testid="branches-memory">
      <div className="scaption">Memory variables</div>
      {view.memoryVars.length === 0 ? (
        <p className="muted">No memory variables declared yet.</p>
      ) : (
        <div className="branch-meta">
          {view.memoryVars.map((v) => (
            <div key={v.name} className="branch-meta__row" data-testid={`branches-memvar-${v.name}`}>
              <span>
                {v.name} <span className="branch-cell-mono">({v.type})</span>
              </span>
              <span className="muted" style={{ textAlign: "right" }}>
                {v.note}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
