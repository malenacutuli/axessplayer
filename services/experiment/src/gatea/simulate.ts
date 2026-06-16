// Prompt 01 / T8 demo: a session simulator that exercises the full harness end to end. Real D1/D7 needs
// real viewers over days; this generates synthetic sessions with a KNOWN ground truth (a planted lift,
// or flat) so the readout, the sequential test, and the off-policy estimator can be demonstrated and
// unit-tested. It uses the real hero variant ids so it mirrors the seeded mobile fixture. No em dashes.

import { assignArm } from "./arm.js";
import { selectTreatment, controlImpression, type Variant } from "./policy.js";
import type { ImpressionRecord } from "./readout.js";

// The seeded hero spine: 6 beats, each slow (control/showrunner) + fast (candidate). Ids match
// tools/fixtures/seed-mobile-hero.sql.
export const HERO_BEATS = [
  { beatId: "2a000000-0000-0000-0000-0000000000b1", control: "2a000000-0000-0000-0000-0000000000a1", candidate: "2a000000-0000-0000-0000-0000000000f1" },
  { beatId: "2a000000-0000-0000-0000-0000000000b2", control: "2a000000-0000-0000-0000-0000000000a2", candidate: "2a000000-0000-0000-0000-0000000000f2" },
  { beatId: "2a000000-0000-0000-0000-0000000000b3", control: "2a000000-0000-0000-0000-0000000000a3", candidate: "2a000000-0000-0000-0000-0000000000f3" },
  { beatId: "2a000000-0000-0000-0000-0000000000b4", control: "2a000000-0000-0000-0000-0000000000a4", candidate: "2a000000-0000-0000-0000-0000000000f4" },
  { beatId: "2a000000-0000-0000-0000-0000000000b5", control: "2a000000-0000-0000-0000-0000000000a5", candidate: "2a000000-0000-0000-0000-0000000000f5" },
  { beatId: "2a000000-0000-0000-0000-0000000000b6", control: "2a000000-0000-0000-0000-0000000000a6", candidate: "2a000000-0000-0000-0000-0000000000f6" },
];

export type Scenario = "lift" | "flat";

function rngFrom(seedStr: string): () => number {
  let h = 2166136261 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SimOptions = { viewers: number; scenario: Scenario; epsilon?: number; seed?: number };

// Ground-truth quality of the candidate (fast) vs control (slow). In "lift" the candidate is genuinely
// better, so an epsilon-greedy treatment arm that prefers it lifts D7. In "flat" they are identical.
function truth(scenario: Scenario) {
  if (scenario === "lift") {
    return { compCtl: 0.66, compCand: 0.82, d7Base: 0.3, d7Delta: 0.08, contCtl: 0.6, contCand: 0.78 };
  }
  return { compCtl: 0.74, compCand: 0.74, d7Base: 0.3, d7Delta: 0.0, contCtl: 0.7, contCand: 0.7 };
}

export function simulateExperiment(opts: SimOptions): ImpressionRecord[] {
  const epsilon = opts.epsilon ?? 0.1;
  const T = truth(opts.scenario);
  // The policy's learned value estimate: candidate higher in lift, equal in flat. Greedy picks accordingly.
  const surrogateByVariant: Record<string, number> = {};
  for (const b of HERO_BEATS) {
    surrogateByVariant[b.candidate] = opts.scenario === "lift" ? 0.7 : 0.5;
    surrogateByVariant[b.control] = 0.5;
  }
  const out: ImpressionRecord[] = [];
  const baseSeed = opts.seed ?? 7;
  for (let i = 0; i < opts.viewers; i++) {
    const viewerId = `v-${baseSeed}-${i}`;
    const sessionId = `s-${baseSeed}-${i}`;
    const arm = assignArm(viewerId);
    const rng = rngFrom(`${baseSeed}:${viewerId}`);
    let gotCandidateCount = 0;
    const perBeat: { beatId: string; variantId: string; propensity: number; policyVersion: string; isCand: boolean }[] = [];
    for (const b of HERO_BEATS) {
      if (arm === "control") {
        const sel = controlImpression(b.control);
        perBeat.push({ beatId: b.beatId, variantId: sel.variantId, propensity: sel.propensity, policyVersion: sel.policyVersion, isCand: false });
      } else {
        const variants: Variant[] = [{ variantId: b.control }, { variantId: b.candidate }];
        const sel = selectTreatment(variants, surrogateByVariant, epsilon, rng);
        const isCand = sel.variantId === b.candidate;
        if (isCand) gotCandidateCount++;
        perBeat.push({ beatId: b.beatId, variantId: sel.variantId, propensity: sel.propensity, policyVersion: sel.policyVersion, isCand });
      }
    }
    // viewer quality = fraction of beats served the better (candidate) variant
    const quality = arm === "treatment" ? gotCandidateCount / HERO_BEATS.length : 0;
    const d7Prob = T.d7Base + T.d7Delta * quality;
    const d1Prob = Math.min(1, d7Prob + 0.2);
    const d7 = rng() < d7Prob;
    const d1 = rng() < d1Prob;
    const completed = rng() < (arm === "treatment" ? 0.5 + 0.2 * quality : 0.5);
    // guardrails: same base both arms (lift comes from retention, not paywall pressure)
    const paywall = rng() < 0.18;
    for (const pb of perBeat) {
      const comp = pb.isCand ? T.compCand : T.compCtl;
      const beat_completion = Math.max(0, Math.min(1, comp + (rng() - 0.5) * 0.1));
      const session_continuation = rng() < (pb.isCand ? T.contCand : T.contCtl);
      const skip_rage = rng() < (beat_completion < 0.4 ? 0.25 : 0.04);
      out.push({
        viewerId, sessionId, beatId: pb.beatId, variantId: pb.variantId, arm,
        propensity: pb.propensity, policyVersion: pb.policyVersion, ts: i * 1000,
        surrogate: { beat_completion, session_continuation, next_session_within_24h: d1 },
        d1_return: d1, d7_return: d7, series_completed: completed, paywall_converted: paywall, skip_rage,
      });
    }
  }
  return out;
}

// The candidate policy for the off-policy estimate: a greedy policy that always picks the candidate
// (fast) variant. Probability 1 on the candidate, 0 on control. Used to estimate "what if we shipped
// the greedy policy" from logged treatment data.
export function greedyCandidateProb(r: ImpressionRecord): number {
  const beat = HERO_BEATS.find((b) => b.beatId === r.beatId);
  if (!beat) return 0;
  return r.variantId === beat.candidate ? 1 : 0;
}
