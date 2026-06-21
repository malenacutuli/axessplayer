// Prompt 01 / T7: the measurement harness readout. Per-arm D1/D7 retention, completion, mean surrogate,
// and the guardrails, with an always-valid confidence sequence on the D7 difference (so we can stop as
// soon as the result is conclusive), plus a context-free off-policy estimate (SNIPS) of a candidate
// policy on logged treatment data, reported as a BAND not a point (CORRECTIONS C6). The full LinUCB
// doubly-robust pipeline is services/experiment/src/ope.ts (prompt 03). No em dashes.

import type { Arm } from "./arm.js";
import type { SurrogateComponents } from "./surrogate.js";
import { surrogateReward } from "./surrogate.js";

// One logged impression plus the session-end + delayed outcomes attributed to its viewer. In production
// these arrive at different times and are joined; here they are denormalized for the readout.
export type ImpressionRecord = {
  viewerId: string;
  sessionId: string;
  beatId: string;
  variantId: string;
  arm: Arm;
  propensity: number;
  policyVersion: string;
  ts: number;
  surrogate: SurrogateComponents;
  // viewer-level outcomes (same for every impression of a viewer; deduped by viewer where needed):
  d1_return: boolean;
  d7_return: boolean;
  series_completed: boolean;
  paywall_converted: boolean; // guardrail (proxy): must not degrade
  skip_rage: boolean; // guardrail: must not increase
};

export type ArmMetrics = {
  arm: Arm;
  impressions: number;
  viewers: number;
  completionRate: number; // mean beat_completion over impressions
  meanSurrogate: number;
  d1Return: number; // per viewer
  d7Return: number; // per viewer
  seriesCompletion: number; // per viewer
  paywallConversion: number; // per viewer guardrail
  skipRageRate: number; // per impression guardrail
};

function byViewer(rows: ImpressionRecord[]): Map<string, ImpressionRecord> {
  const m = new Map<string, ImpressionRecord>();
  for (const r of rows) if (!m.has(r.viewerId)) m.set(r.viewerId, r);
  return m;
}

export function armMetrics(arm: Arm, rows: ImpressionRecord[]): ArmMetrics {
  const viewers = [...byViewer(rows).values()];
  const nV = viewers.length || 1;
  const nI = rows.length || 1;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  return {
    arm,
    impressions: rows.length,
    viewers: viewers.length,
    completionRate: mean(rows.map((r) => r.surrogate.beat_completion)),
    meanSurrogate: mean(rows.map((r) => surrogateReward(r.surrogate))),
    d1Return: viewers.filter((v) => v.d1_return).length / nV,
    d7Return: viewers.filter((v) => v.d7_return).length / nV,
    seriesCompletion: viewers.filter((v) => v.series_completed).length / nV,
    paywallConversion: viewers.filter((v) => v.paywall_converted).length / nV,
    skipRageRate: rows.filter((r) => r.skip_rage).length / nI,
  };
}

// Always-valid confidence radius for the mean of [0,1]-bounded i.i.d. observations at sample size n.
// Hoeffding-style mixture boundary (Howard et al. 2021, sub-Gaussian): valid at every n simultaneously,
// so peeking does not inflate the error. Conservative but honest. Returns Infinity for n < 1.
export function alwaysValidRadius(n: number, alpha = 0.05): number {
  if (n < 1) return Infinity;
  // r(n) = sqrt( ((n+1) / (2 n^2)) * ln( sqrt(n+1) / alpha ) )  for variance-1/4 bounded variables.
  return Math.sqrt(((n + 1) / (2 * n * n)) * Math.log(Math.sqrt(n + 1) / alpha));
}

export type SequentialVerdict = {
  diff: number; // treatment d7 - control d7 (absolute, in proportion points)
  lo: number; // always-valid lower bound on the difference
  hi: number; // always-valid upper bound
  verdict: "green" | "flat_or_negative" | "inconclusive";
};

// Sequential significance on the D7 difference, per viewer. The decision threshold is a >= 2 point
// absolute lift whose confidence sequence excludes it from below. green only when the lower bound clears
// +0.02; flat_or_negative when the upper bound is below +0.02; otherwise keep collecting (inconclusive).
export function d7Sequential(control: ImpressionRecord[], treatment: ImpressionRecord[], alpha = 0.05, threshold = 0.02): SequentialVerdict {
  const c = armMetrics("control", control);
  const t = armMetrics("treatment", treatment);
  const diff = t.d7Return - c.d7Return;
  const rad = alwaysValidRadius(c.viewers, alpha) + alwaysValidRadius(t.viewers, alpha);
  const lo = diff - rad;
  const hi = diff + rad;
  const verdict = lo >= threshold ? "green" : hi < threshold ? "flat_or_negative" : "inconclusive";
  return { diff, lo, hi, verdict };
}

// Context-free off-policy estimate of a candidate policy on logged TREATMENT data, using the
// self-normalized IPS (SNIPS) estimator with the surrogate reward. candidateProb gives the candidate
// policy's probability of the logged arm at that beat. Reported with a bootstrap percentile band; never
// a bare point number (C6).
export type OffPolicyBand = { estimate: number; lo: number; hi: number; ess: number; n: number };

export function snipsBand(
  treatment: ImpressionRecord[],
  candidateProb: (r: ImpressionRecord) => number,
  opts: { weightClip?: number; bootstraps?: number; alpha?: number; seed?: number } = {},
): OffPolicyBand {
  const clip = opts.weightClip ?? 50;
  const B = opts.bootstraps ?? 500;
  const alpha = opts.alpha ?? 0.05;
  const rows = treatment.filter((r) => r.propensity > 0);
  const snips = (sample: ImpressionRecord[]): number => {
    let num = 0, den = 0;
    for (const r of sample) {
      const w = Math.min(clip, candidateProb(r) / r.propensity);
      num += w * surrogateReward(r.surrogate);
      den += w;
    }
    return den === 0 ? 0 : num / den;
  };
  const estimate = snips(rows);
  // effective sample size of the importance weights
  let sw = 0, sw2 = 0;
  for (const r of rows) {
    const w = Math.min(clip, candidateProb(r) / r.propensity);
    sw += w; sw2 += w * w;
  }
  const ess = sw2 === 0 ? 0 : (sw * sw) / sw2;
  // deterministic bootstrap for the band
  let a = (opts.seed ?? 12345) >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const boots: number[] = [];
  if (rows.length > 0) {
    for (let b = 0; b < B; b++) {
      const sample: ImpressionRecord[] = [];
      for (let i = 0; i < rows.length; i++) sample.push(rows[Math.floor(rng() * rows.length)]);
      boots.push(snips(sample));
    }
    boots.sort((x, y) => x - y);
  }
  const pick = (q: number) => (boots.length ? boots[Math.min(boots.length - 1, Math.floor(q * boots.length))] : estimate);
  return { estimate, lo: pick(alpha / 2), hi: pick(1 - alpha / 2), ess, n: rows.length };
}

// T4: the headline Adaptive Lift the directive defines, the RELATIVE lift = (adapted - control) / control on
// the chosen objective (D7 return by default, or continuation), with a confidence interval. The absolute
// difference and its always-valid band come from the same machinery as d7Sequential; this expresses them as
// a ratio over the control base rate and propagates the band. controlRate 0 yields a null ratio (reported as
// undefined), never a divide-by-zero.
export type AdaptiveLift = {
  objective: "d7_return" | "continuation";
  controlRate: number;
  adaptedRate: number;
  absoluteDiff: number;
  relativeLift: number | null; // (adapted - control) / control
  ciLo: number | null; // relative-lift CI = (absoluteDiff -/+ always-valid radius) / control
  ciHi: number | null;
  nControl: number;
  nAdapted: number;
};

export function adaptiveLift(
  rows: ImpressionRecord[],
  opts: { objective?: "d7_return" | "continuation"; alpha?: number } = {},
): AdaptiveLift {
  const objective = opts.objective ?? "d7_return";
  const alpha = opts.alpha ?? 0.05;
  const control = rows.filter((r) => r.arm === "control");
  const treatment = rows.filter((r) => r.arm === "treatment");
  const rate = (rs: ImpressionRecord[]): number => {
    const v = [...byViewer(rs).values()];
    if (v.length === 0) return 0;
    const hit = objective === "d7_return" ? v.filter((x) => x.d7_return).length : v.filter((x) => x.series_completed).length;
    return hit / v.length;
  };
  const controlRate = rate(control);
  const adaptedRate = rate(treatment);
  const absoluteDiff = adaptedRate - controlRate;
  const nControl = byViewer(control).size;
  const nAdapted = byViewer(treatment).size;
  const rad = alwaysValidRadius(nControl, alpha) + alwaysValidRadius(nAdapted, alpha);
  const rel = controlRate > 0 ? absoluteDiff / controlRate : null;
  const ciLo = controlRate > 0 ? (absoluteDiff - rad) / controlRate : null;
  const ciHi = controlRate > 0 ? (absoluteDiff + rad) / controlRate : null;
  return { objective, controlRate, adaptedRate, absoluteDiff, relativeLift: rel, ciLo, ciHi, nControl, nAdapted };
}

export type Readout = {
  control: ArmMetrics;
  treatment: ArmMetrics;
  d7: SequentialVerdict;
  lift: AdaptiveLift; // T4 headline relative Adaptive Lift with CI
  guardrails: { paywallDelta: number; skipRageDelta: number; ok: boolean };
  gateA: "green" | "flat_or_negative" | "inconclusive";
};

// The full Gate A readout. Gate A is green only when the D7 sequential verdict is green AND no guardrail
// degraded (paywall conversion not down materially, skip-rage not up materially).
export function gateAReadout(rows: ImpressionRecord[], alpha = 0.05, threshold = 0.02): Readout {
  const control = rows.filter((r) => r.arm === "control");
  const treatment = rows.filter((r) => r.arm === "treatment");
  const c = armMetrics("control", control);
  const t = armMetrics("treatment", treatment);
  const d7 = d7Sequential(control, treatment, alpha, threshold);
  const paywallDelta = t.paywallConversion - c.paywallConversion;
  const skipRageDelta = t.skipRageRate - c.skipRageRate;
  // Noise-aware guardrails: a guardrail breaches only when the delta is CONCLUSIVELY bad beyond the
  // always-valid band, never on sampling noise. paywall conversion must not conclusively drop > 1pt;
  // skip-rage must not conclusively rise > 2pts.
  const gRad = alwaysValidRadius(c.viewers, alpha) + alwaysValidRadius(t.viewers, alpha);
  const sRad = alwaysValidRadius(control.length, alpha) + alwaysValidRadius(treatment.length, alpha);
  const guardrailsOk = paywallDelta + gRad >= -0.01 && skipRageDelta - sRad <= 0.02;
  // green only when D7 is conclusively up AND guardrails hold; a D7-green with a guardrail breach is
  // inconclusive (keep collecting / investigate), never an automatic green.
  const gateA = d7.verdict !== "green" ? d7.verdict : guardrailsOk ? "green" : "inconclusive";
  const lift = adaptiveLift(rows, { alpha });
  return { control: c, treatment: t, d7, lift, guardrails: { paywallDelta, skipRageDelta, ok: guardrailsOk }, gateA };
}
