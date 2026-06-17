// P8-T3 Studio analytics. Beat-level retention (an OBSERVED metric, shown as a measured rate) and the
// off-policy counterfactual for a candidate cut, shown ONLY as an uncertainty band or a coarse win-rate,
// never a clean point number (CORRECTIONS C6: a confident wrong number burns trust). The display objects
// come from services/experiment (counterfactualDisplay, beatRetentionCurve); this panel renders them.
// Types are mirrored locally to keep the browser bundle free of the experiment package's node deps.
// No em dashes.

export type BeatRetention = { beatId: string; reached: number; completed: number; completionRate: number };
export type Counterfactual =
  | { kind: "uplift_band"; text: string; loPct: number; hiPct: number; direction: "up" | "down" }
  | { kind: "inconclusive"; text: string };

export interface AnalyticsPanelProps {
  beats: BeatRetention[];
  // Optional: a candidate cut's off-policy counterfactual vs the current cut. Absent until enough data.
  counterfactual?: Counterfactual;
}

export function AnalyticsPanel({ beats, counterfactual }: AnalyticsPanelProps) {
  return (
    <section data-testid="panel-analytics" className="pad">
      <h2 style={{ marginTop: 8 }}>Analytics</h2>

      <div data-testid="beat-retention">
        <div className="muted" style={{ marginBottom: 6 }}>Beat-level retention (observed)</div>
        {beats.length === 0 ? (
          <p className="muted" data-testid="analytics-empty">No engagement yet.</p>
        ) : (
          beats.map((b) => {
            const pct = Math.round(b.completionRate * 100);
            return (
              <div key={b.beatId} data-testid={`retention-${b.beatId}`} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                <span style={{ width: 90, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{b.beatId.slice(-6)}</span>
                <div style={{ flex: 1, background: "rgba(0,0,0,0.08)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: 8, background: "var(--brand, #6c5ce7)" }} />
                </div>
                <span className="muted" style={{ width: 120, fontSize: 11 }}>{pct}% completed ({b.completed}/{b.reached})</span>
              </div>
            );
          })
        )}
      </div>

      {counterfactual && (
        <div data-testid="counterfactual" data-kind={counterfactual.kind} style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            Candidate cut, off-policy estimate (an uncertainty band, not a guarantee):
          </div>
          <b data-testid="counterfactual-text">{counterfactual.text}</b>
        </div>
      )}
    </section>
  );
}
