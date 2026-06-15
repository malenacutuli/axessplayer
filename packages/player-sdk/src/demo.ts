// Demo harness (DoD): walk a seed graph cold-open -> branch -> ending against a fake transport (the
// same shape the Prism mocks of decision + manifest serve) and log each switch point, asserting zero
// reported gap. Run: `node --import tsx src/demo.ts` from this package. Against live mocks, swap the
// FakeTransport for createHttpTransport({ decisionBaseUrl, manifestBaseUrl }). This proves the
// buffering + switch-decision logic only; device-level frame accuracy is W5's on-hardware phase and
// is NOT demonstrated here. No em dashes.

import { BranchingPlayer } from "./player.js";
import { FakeTransport, type GraphNode } from "./test-graph.js";

const OPEN = "00000000-0000-0000-0000-000000000001";
const CALM = "aaaaaaaa-0000-0000-0000-0000000000a1";
const TENSE = "bbbbbbbb-0000-0000-0000-0000000000b1";
const CALM2 = "cccccccc-0000-0000-0000-0000000000c1";
const ENDING = "eeeeeeee-0000-0000-0000-0000000000e1";

const graph: Record<string, GraphNode> = {
  // cold open: choose the tense cut, pre-buffer the calm alternative.
  [OPEN]: { nextVariantId: TENSE, prefetchVariantIds: [CALM] },
  // after tense: choose calm2, pre-buffer nothing else.
  [TENSE]: { nextVariantId: CALM2, prefetchVariantIds: [] },
  // after calm2: head to the ending.
  [CALM2]: { nextVariantId: ENDING, prefetchVariantIds: [] },
  // ENDING absent -> 422.
};

async function main(): Promise<void> {
  const transport = new FakeTransport({ graph });
  const player = new BranchingPlayer({ transport, userId: "demo-viewer", startBeatId: OPEN });

  // Simulate a viewer leaning in so the next decision sees real signals.
  player.recordSignals({ completion: 1, dwell_ms: 5200 });

  const steps = await player.play();

  let gaps = 0;
  console.log("switch points (cold-open -> branch -> ending):");
  for (const step of steps) {
    const gap = step.played.seamless ? "no-gap" : "GAP";
    if (!step.played.seamless) gaps++;
    console.log(
      `  beat ${short(step.beatId)} -> play ${short(step.played.variantId)}` +
        ` [${step.played.reason}] ${gap}` +
        ` buffered=[${step.bufferedAtBranch.map(short).join(",")}]`
    );
  }
  console.log(
    `\nwalked ${steps.length} branch points, ${gaps} reported gap(s), ` +
      `${transport.calls.manifest} manifest fetches, ${transport.calls.decide} decide calls`
  );
  if (gaps !== 0) {
    console.error("FAIL: a gap was reported");
    process.exitCode = 1;
    return;
  }
  console.log("OK: zero reported gap (buffering + switch logic). Device frame accuracy: NOT proven here.");
}

function short(id: string): string {
  return id.slice(0, 8);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
