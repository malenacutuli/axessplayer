// Prompt 01 readout runner. Demonstrates the measurement harness end to end on simulated sessions with
// a known ground truth (the live D1/D7 verdict reads from real logged data once viewers accrue; this
// proves the readout, sequential test, guardrails, and off-policy estimator compute correctly).
// Run: pnpm --filter @axessplayer/experiment exec node --import tsx src/gatea/run-readout.ts [lift|flat] [viewers]
// No em dashes.

import { gateAReadout, snipsBand, type ImpressionRecord } from "./readout.js";
import { simulateExperiment, greedyCandidateProb, type Scenario } from "./simulate.js";

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function report(scenario: Scenario, viewers: number): void {
  const rows: ImpressionRecord[] = simulateExperiment({ viewers, scenario });
  const r = gateAReadout(rows);
  const band = snipsBand(rows.filter((x) => x.arm === "treatment"), greedyCandidateProb, { bootstraps: 400 });
  console.log(`\n=== Gate A readout: scenario=${scenario}, viewers=${viewers} ===`);
  for (const a of [r.control, r.treatment]) {
    console.log(
      `  ${a.arm.padEnd(9)} viewers=${a.viewers} impressions=${a.impressions} ` +
      `D1=${pct(a.d1Return)} D7=${pct(a.d7Return)} completion=${pct(a.completionRate)} ` +
      `surrogate=${a.meanSurrogate.toFixed(3)} paywall=${pct(a.paywallConversion)} skipRage=${pct(a.skipRageRate)}`,
    );
  }
  console.log(
    `  D7 difference: ${pct(r.d7.diff)}  always-valid 95% CI [${pct(r.d7.lo)}, ${pct(r.d7.hi)}]  sequential verdict: ${r.d7.verdict}`,
  );
  console.log(
    `  guardrails: paywallDelta=${pct(r.guardrails.paywallDelta)} skipRageDelta=${pct(r.guardrails.skipRageDelta)} ok=${r.guardrails.ok}`,
  );
  console.log(
    `  off-policy (greedy candidate, SNIPS, surrogate): ${band.estimate.toFixed(3)} band [${band.lo.toFixed(3)}, ${band.hi.toFixed(3)}] ESS=${band.ess.toFixed(0)} (shown as a band, not a point, per C6)`,
  );
  console.log(`  GATE A: ${r.gateA.toUpperCase()}`);
}

const scenario = (process.argv[2] as Scenario) || "lift";
const viewers = Number(process.argv[3] ?? 20000);
report(scenario, viewers);
if (!process.argv[2]) report("flat", viewers); // default run shows both for contrast
