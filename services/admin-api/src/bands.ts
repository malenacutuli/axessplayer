// Counterfactual / estimate BAND math for the admin analytics + growth surfaces. HARD RULE (mirrors
// services/experiment/src/presentation.ts C6): an off-policy counterfactual, a branch lift, or a CAC/LTV
// projection is a high-variance estimate and is NEVER surfaced as a clean point number. It is surfaced as
// an uncertainty band { low, high, center } and, when the band straddles zero, it is labeled inconclusive
// rather than implying a win. This module is PURE (no DB, no I/O) so the band derivation is unit-testable.
// No em dashes.

// The canonical band shape the admin contract returns for every estimate. center is the point estimate;
// low/high are the band edges. This matches the {low, high, center} the slice contract asks for (the
// experiment service uses {lo, hi, estimate}; the admin contract uses the spelled-out names so the console
// codes against an unambiguous shape).
export interface Band {
  low: number;
  high: number;
  center: number;
}

// A band plus the inconclusive verdict, so a caller never has to re-derive whether the band straddles a
// reference value. direction is "up"/"down" only when the band is decisively one side of the reference.
export interface BandVerdict {
  band: Band;
  // true when the band crosses the reference (typically 0 for a relative lift), i.e. no clear win/loss.
  inconclusive: boolean;
  direction: "up" | "down" | "none";
}

// Build a symmetric band around a center given a non-negative half-width (margin). A negative or
// non-finite margin is clamped to 0 (a degenerate point band), and a non-finite center collapses to 0, so
// a bad input never produces a NaN edge. low <= center <= high always holds.
export function bandFromMargin(center: number, margin: number): Band {
  const c = Number.isFinite(center) ? center : 0;
  const m = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  return { low: c - m, high: c + m, center: c };
}

// Derive an uncertainty band for a binomial RATE (successes / trials) using a normal-approximation
// half-width z * sqrt(p(1-p)/n). This is the honest way to turn a raw conversion rate into a band: a rate
// computed from 3 trials gets a huge band, a rate from 30k trials gets a tight one, so the console can
// never present a sparse-data rate as a confident point. trials <= 0 yields a full [0,1] band centered at
// 0 (no evidence). z defaults to 1.96 (about 95%).
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
// which is the only sanctioned framing for a counterfactual lift (C6). The lift is on the rate scale
// (a difference of probabilities), not a percentage point claim.
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
  // Half-widths of each group's rate band; combine independent variances in quadrature.
  const tHalf = (t.high - t.low) / 2;
  const cHalf = (c.high - c.low) / 2;
  const margin = Math.sqrt(tHalf * tHalf + cHalf * cHalf);
  const band = bandFromMargin(center, margin);
  return verdictAroundZero(band);
}

// Classify a band against a reference value (default 0). Inconclusive when the band spans the reference.
// Otherwise the direction is up when the whole band is above the reference, down when below.
export function verdictAroundZero(band: Band, reference = 0): BandVerdict {
  if (band.low <= reference && band.high >= reference) {
    return { band, inconclusive: true, direction: "none" };
  }
  return { band, inconclusive: false, direction: band.low > reference ? "up" : "down" };
}
