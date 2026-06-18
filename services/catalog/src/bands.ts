// Counterfactual / estimate BAND math for the catalog creator analytics surface. HARD RULE (mirrors
// services/admin-api/src/bands.ts and the project rule "COUNTERFACTUALS AS BANDS NEVER POINTS"): an
// off-policy branch lift is a high-variance estimate and is NEVER surfaced as a clean point number. It is
// surfaced as an uncertainty band { low, high, center } and, when the band straddles zero, it is labeled
// inconclusive rather than implying a win. This module is PURE (no DB, no I/O) so the band derivation is
// unit-testable. The math is COPIED from admin-api/bands.ts (catalog must not import admin-api). No em dashes.

// The canonical band shape the creator analytics contract returns for every estimate. center is the point
// estimate; low/high are the band edges. Matches the {low, high, center} the @axessplayer/ui LiftBand
// renders.
export interface Band {
  low: number;
  high: number;
  center: number;
}

// A band plus the inconclusive verdict, so a caller never has to re-derive whether the band straddles a
// reference value. direction is "up"/"down" only when the band is decisively one side of the reference.
export interface BandVerdict {
  band: Band;
  inconclusive: boolean;
  direction: "up" | "down" | "none";
}

// Build a symmetric band around a center given a non-negative half-width (margin). A negative or
// non-finite margin clamps to 0 (a degenerate point band); a non-finite center collapses to 0; so a bad
// input never produces a NaN edge. low <= center <= high always holds.
export function bandFromMargin(center: number, margin: number): Band {
  const c = Number.isFinite(center) ? center : 0;
  const m = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  return { low: c - m, high: c + m, center: c };
}

// Derive an uncertainty band for a binomial RATE (successes / trials) using a normal-approximation
// half-width z * sqrt(p(1-p)/n). A rate from 3 trials gets a huge band; a rate from 30k gets a tight one;
// so a sparse-data rate is never presented as a confident point. trials <= 0 yields a full [0,1] band
// centered at 0 (no evidence). z defaults to 1.96 (about 95%).
export function rateBand(successes: number, trials: number, z = 1.96): Band {
  const n = Number.isFinite(trials) ? Math.max(0, Math.floor(trials)) : 0;
  if (n === 0) return { low: 0, high: 1, center: 0 };
  const s = Number.isFinite(successes) ? Math.max(0, Math.min(successes, n)) : 0;
  const p = s / n;
  const margin = z * Math.sqrt((p * (1 - p)) / n);
  return { low: Math.max(0, p - margin), high: Math.min(1, p + margin), center: p };
}

// Relative LIFT band of a treatment rate vs a control rate, expressed as (treatment - control). Combines
// the two rate bands' half-widths in quadrature (independent groups). The center is the point lift; the
// band reflects BOTH groups' sampling noise. When the band straddles zero the verdict is inconclusive,
// which is the only sanctioned framing for a counterfactual lift. The lift is on the rate scale (a
// difference of probabilities), not a percentage point claim.
export function liftBand(
  treatmentSuccesses: number,
  treatmentTrials: number,
  controlSuccesses: number,
  controlTrials: number,
  z = 1.96,
): BandVerdict {
  const t = rateBand(treatmentSuccesses, treatmentTrials, z);
  const c = rateBand(controlSuccesses, controlTrials, z);
  const center = t.center - c.center;
  const tHalf = (t.high - t.low) / 2;
  const cHalf = (c.high - c.low) / 2;
  const margin = Math.sqrt(tHalf * tHalf + cHalf * cHalf);
  return verdictAroundZero(bandFromMargin(center, margin));
}

// Classify a band against a reference value (default 0). Inconclusive when the band spans the reference.
// Otherwise the direction is up when the whole band is above the reference, down when below.
export function verdictAroundZero(band: Band, reference = 0): BandVerdict {
  if (band.low <= reference && band.high >= reference) {
    return { band, inconclusive: true, direction: "none" };
  }
  return { band, inconclusive: false, direction: band.low > reference ? "up" : "down" };
}
