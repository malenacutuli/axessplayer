// P9 adaptive-policy console: operator alerts from each series' Gate A readout. The console does NOT
// re-decide the policy; it surfaces where attention is needed (a guardrail breach, a negative cut, an
// experiment stuck inconclusive). Off-policy counterfactuals are shown elsewhere as bands (C6), never as a
// point that drives an automatic action. No em dashes.

export type SeriesReadout = {
  seriesId: string;
  gateA: "green" | "flat_or_negative" | "inconclusive";
  guardrailsOk: boolean;
  d7Diff: number; // treatment - control, in proportion points
  viewers: number;
};

export type Alert = { seriesId: string; severity: "info" | "warn" | "critical"; message: string };

// Thresholds are operator tunables (flagged). inconclusiveViewers: above this many viewers and still
// inconclusive means the effect is too small to matter or the design is underpowered, worth a look.
export const ALERT_THRESHOLDS = { inconclusiveViewers: 50000 } as const;

export function policyAlerts(readouts: SeriesReadout[], thresholds = ALERT_THRESHOLDS): Alert[] {
  const out: Alert[] = [];
  for (const r of readouts) {
    if (!r.guardrailsOk) {
      out.push({ seriesId: r.seriesId, severity: "critical", message: "guardrail breach (paywall or skip-rage degraded); pause the bandit and review" });
    }
    if (r.gateA === "flat_or_negative" && r.d7Diff < 0) {
      out.push({ seriesId: r.seriesId, severity: "warn", message: `adaptive cut is underperforming the fixed cut (D7 ${(r.d7Diff * 100).toFixed(1)} pts); investigate` });
    }
    if (r.gateA === "inconclusive" && r.viewers >= thresholds.inconclusiveViewers) {
      out.push({ seriesId: r.seriesId, severity: "info", message: "inconclusive at scale; effect is small or the design is underpowered" });
    }
  }
  return out;
}
