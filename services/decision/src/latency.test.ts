// Serving-path latency measurement against the KV layer (NOT Postgres). This is an IN-MEMORY
// micro-benchmark over the in-memory KV fake; it measures the cost of the decision arithmetic and the
// fake KV reads on this machine. It is NOT a production KV (Redis/edge KV) latency measurement and must
// not be reported as one. It exists to show the decision path is cheap linear algebra, as the design
// claims, and to fail loudly if the path regresses into something pathological. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, type DecisionDB, type DecideDeps } from "./decide.js";
import { canonFilter, type CanonCandidate } from "./canon.js";
import { InMemoryKV } from "./kv.js";
import { InMemoryLogger } from "./logger.js";
import { InMemoryCohortSeeds } from "./features.js";
import { assignControl } from "./policy.js";

const CALM = "cccccccc-0000-0000-0000-00000000000a";
const TENSE = "cccccccc-0000-0000-0000-00000000000b";
const BEAT = "bbbbbbbb-0000-0000-0000-000000000002";

const candidates: CanonCandidate[] = [
  { variantId: CALM, branch: "calm", validEdge: true },
  { variantId: TENSE, branch: "tense", validEdge: true },
];

function db(): DecisionDB {
  return {
    seriesOfBeat: async () => "11111111-1111-1111-1111-111111111111",
    candidatesOf: async () => candidates,
    canonFactsOf: async () => ({}),
    cohortOf: async () => null,
    adaptiveOptIn: async () => true,
  };
}

function treatmentId(i: number): string {
  // Walk until we hit a treatment-bucket id so we exercise the bandit path, not the fallback.
  for (let k = i * 31; ; k++) if (!assignControl("lat-" + k)) return "lat-" + k;
}

test("serving-path latency over the in-memory KV (micro-benchmark, not a production measurement)", async () => {
  const deps: DecideDeps = {
    db: db(),
    kv: new InMemoryKV(),
    logger: new InMemoryLogger(),
    cohorts: new InMemoryCohortSeeds(),
  };

  const N = 2000;
  // Warm-up so we measure steady state, not JIT compile.
  for (let i = 0; i < 200; i++) await decide({ user_id: treatmentId(i), current_beat_id: BEAT, signals: { completion: 0.7 } }, deps);

  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await decide({ user_id: treatmentId(i + 1000), current_beat_id: BEAT, signals: { completion: 0.7 } }, deps);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  const p50 = p(0.5);
  const p99 = p(0.99);
  console.log(
    `serving path (in-memory KV fake, N=${N}): p50 ${p50.toFixed(4)}ms, p99 ${p99.toFixed(4)}ms. ` +
      `IN-MEMORY micro-benchmark only, NOT a production Redis/edge-KV measurement.`
  );
  // Sanity ceiling only: the in-memory path is pure arithmetic and must stay well under the 50ms budget.
  // This is NOT a claim about production latency.
  assert.ok(p99 < 50, `in-memory p99 ${p99.toFixed(4)}ms unexpectedly exceeded the 50ms sanity ceiling`);
});
