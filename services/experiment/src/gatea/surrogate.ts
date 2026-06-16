// Prompt 01 / T5: the session-end surrogate reward (CORRECTIONS C4). It is available immediately at
// session end, so the bandit can learn without waiting 7 days. We log the RAW components, not just the
// blend, so the weighting can be re-tuned offline. D1/D7 retention is the OFFLINE guardrail the
// surrogate is validated against (correlation), never the bandit's direct input. No em dashes.

export type SurrogateComponents = {
  beat_completion: number; // 0..1, fraction of the beat watched
  session_continuation: boolean; // advanced to the next beat in this session
  next_session_within_24h: boolean; // returned within 24h, the fast proxy checked against real D1/D7
};

// Weights are a starting point; because raw components are logged, they can be re-fit offline against
// the D7 guardrail without re-running the experiment.
export const SURROGATE_WEIGHTS = { completion: 0.5, continuation: 0.3, next24h: 0.2 } as const;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Blended surrogate in [0,1].
export function surrogateReward(c: SurrogateComponents): number {
  const w = SURROGATE_WEIGHTS;
  return (
    w.completion * clamp01(c.beat_completion) +
    w.continuation * (c.session_continuation ? 1 : 0) +
    w.next24h * (c.next_session_within_24h ? 1 : 0)
  );
}

// Pearson correlation, used offline to VALIDATE that the surrogate tracks the real D7 guardrail before
// the surrogate is trusted as the bandit's reward (C4). Returns 0 for degenerate (zero-variance) inputs.
export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
