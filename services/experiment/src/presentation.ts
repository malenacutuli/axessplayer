// P8-T3 / CORRECTIONS C6: off-policy counterfactuals are high-variance estimates and must NEVER be shown
// to a creator or operator as a clean point number ("variant B would have lifted D7 by X"). They are shown
// as an uncertainty BAND or a directional win-rate, and when the band straddles zero we say inconclusive
// rather than imply a win. Plus beat-level retention from engagement events. No em dashes.

export type Band = { lo: number; hi: number; estimate: number };

export type CounterfactualDisplay =
  | { kind: "uplift_band"; text: string; loPct: number; hiPct: number; direction: "up" | "down" }
  | { kind: "inconclusive"; text: string };

function pct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

// Show the candidate policy's off-policy band as a RELATIVE uplift vs the current policy's value. A band
// that straddles zero is inconclusive (no false confidence). This is the only sanctioned way to surface a
// counterfactual to a human (C6); a bare point number is never produced.
export function counterfactualDisplay(band: Band, baseline: number): CounterfactualDisplay {
  const lo = band.lo - baseline;
  const hi = band.hi - baseline;
  if (lo <= 0 && hi >= 0) {
    return { kind: "inconclusive", text: "No clear difference yet (estimate spans zero; needs more data)" };
  }
  const direction: "up" | "down" = lo > 0 ? "up" : "down";
  return { kind: "uplift_band", text: `${pct(lo)} to ${pct(hi)} vs the current cut`, loPct: lo, hiPct: hi, direction };
}

// A directional win-rate is the other sanctioned framing: the share of the band that beats the baseline,
// expressed as a coarse likelihood, never a precise probability point.
export function winRateLabel(band: Band, baseline: number): string {
  if (band.hi <= band.lo) return "inconclusive";
  const frac = Math.max(0, Math.min(1, (band.hi - baseline) / (band.hi - band.lo)));
  if (frac >= 0.8) return "likely better";
  if (frac <= 0.2) return "likely worse";
  return "too close to call";
}

export type BeatEvent = { beat_id: string; type: string };
export type BeatRetention = { beatId: string; reached: number; completed: number; completionRate: number };

// Beat-level retention from engagement events: how many viewers reached each beat (beat_started) and
// completed it (beat_completed). Order follows the supplied beat order when given, else first-seen order.
export function beatRetentionCurve(events: BeatEvent[], order?: string[]): BeatRetention[] {
  const m = new Map<string, { reached: number; completed: number }>();
  const seen: string[] = [];
  for (const e of events) {
    if (!m.has(e.beat_id)) {
      m.set(e.beat_id, { reached: 0, completed: 0 });
      seen.push(e.beat_id);
    }
    const b = m.get(e.beat_id)!;
    if (e.type === "beat_started") b.reached++;
    else if (e.type === "beat_completed") b.completed++;
  }
  const beats = order ? order.filter((b) => m.has(b)) : seen;
  return beats.map((beatId) => {
    const b = m.get(beatId)!;
    return { beatId, reached: b.reached, completed: b.completed, completionRate: b.reached ? b.completed / b.reached : 0 };
  });
}
