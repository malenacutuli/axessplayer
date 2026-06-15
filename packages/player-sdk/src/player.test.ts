// Integration tests for the BranchingPlayer over a fake seed graph (the same shape a Prism mock of
// decision + manifest serves). One full walk: cold open -> branch -> ending, asserting every branch
// point was a seamless switch (chosen cut buffered, zero reported gap), the loop stops on the
// contract 422, egress is bounded, signals fold into the next /decide, and the fallbacks fire. This
// is the W12-style end-to-end drive. Device-level frame accuracy is NOT proven here. Runner:
// node --test + tsx. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BranchingPlayer } from "./player.js";
import { FakeTransport, type GraphNode } from "./test-graph.js";

// Seed graph: cold-open beat -> chosen cut becomes the next beat -> ending.
//   open  -> next=cutA, hints=[cutB]
//   cutA  -> next=cutC, hints=[cutD]
//   cutC  -> next=cutEnd, hints=[]
//   cutEnd -> (absent) -> ending (422)
const OPEN = "00000000-0000-0000-0000-00000000open".replace("open", "0001");
const CUT_A = "aaaaaaaa-0000-0000-0000-0000000000a1";
const CUT_B = "bbbbbbbb-0000-0000-0000-0000000000b1";
const CUT_C = "cccccccc-0000-0000-0000-0000000000c1";
const CUT_D = "dddddddd-0000-0000-0000-0000000000d1";
const CUT_END = "eeeeeeee-0000-0000-0000-0000000000e1";

function seedGraph(): Record<string, GraphNode> {
  return {
    [OPEN]: { nextVariantId: CUT_A, prefetchVariantIds: [CUT_B] },
    [CUT_A]: { nextVariantId: CUT_C, prefetchVariantIds: [CUT_D] },
    [CUT_C]: { nextVariantId: CUT_END, prefetchVariantIds: [] },
    // CUT_END is absent -> decide rejects 422 (ending).
  };
}

test("full walk cold-open to ending is seamless at every branch point (zero gap)", async () => {
  const transport = new FakeTransport({ graph: seedGraph() });
  const player = new BranchingPlayer({ transport, userId: "viewer-1", startBeatId: OPEN });

  const steps = await player.play();

  assert.equal(steps.length, 3); // open, cutA, cutC ; then 422 at cutEnd
  for (const step of steps) {
    assert.equal(step.played.reason, "chosen", `beat ${step.beatId} should switch to the chosen cut`);
    assert.equal(step.played.seamless, true, `beat ${step.beatId} reported a gap`);
    assert.ok(
      step.bufferedAtBranch.includes(step.decision.next_variant_id),
      "chosen cut must be buffered at the branch point"
    );
    assert.deepEqual(step.missed, []);
  }
  // The played path is the chosen spine.
  assert.deepEqual(
    steps.map((s) => s.played.variantId),
    [CUT_A, CUT_C, CUT_END]
  );
});

test("egress is bounded: each candidate manifest is fetched at most once across the walk", async () => {
  const transport = new FakeTransport({ graph: seedGraph() });
  const player = new BranchingPlayer({ transport, userId: "viewer-1", startBeatId: OPEN });
  await player.play();

  for (const [variant, count] of transport.calls.manifestByVariant) {
    assert.ok(count <= 1, `variant ${variant} fetched ${count} times (expected <= 1)`);
  }
  // 3 decisions over the spine.
  assert.equal(transport.calls.decide, 4); // 3 real + the terminal 422 call
});

test("recorded beat signals fold into the next /decide call", async () => {
  let captured: unknown = null;
  const base = new FakeTransport({ graph: seedGraph() });
  const transport = {
    decide: async (req: Parameters<FakeTransport["decide"]>[0]) => {
      captured = req.signals;
      return base.decide(req);
    },
    fetchManifest: base.fetchManifest.bind(base),
  };
  const player = new BranchingPlayer({ transport, userId: "viewer-1", startBeatId: OPEN });

  player.recordSignals({ completion: 0.9, dwell_ms: 4000 });
  player.recordSignals({ replays: 1 });
  player.recordSignals({ replays: 2 }); // replays accumulates
  await player.advance();

  assert.deepEqual(captured, { completion: 0.9, dwell_ms: 4000, replays: 3 });

  // Signals were reset after the boundary.
  await player.advance();
  assert.deepEqual(captured, {});
});

test("a control viewer is served the deterministic cut with reason control", async () => {
  const graph = seedGraph();
  graph[OPEN].isControl = true;
  const transport = new FakeTransport({ graph });
  const player = new BranchingPlayer({ transport, userId: "control-viewer", startBeatId: OPEN });

  const step = await player.advance();
  assert.equal(step.played.reason, "control");
  assert.equal(step.played.variantId, CUT_A);
  assert.equal(step.played.seamless, true);
});

test("low bandwidth holds the default cut (graceful degrade, no spinner)", async () => {
  const transport = new FakeTransport({ graph: seedGraph() });
  const player = new BranchingPlayer({
    transport,
    userId: "viewer-1",
    startBeatId: OPEN,
    bandwidthFloorKbps: 600,
  });
  player.updateBandwidth(120); // below floor

  const step = await player.advance();
  assert.equal(step.played.reason, "fallback_low_bandwidth");
  // defaultVariantId is the engine's next cut, which IS buffered, so still seamless (no stall).
  assert.equal(step.played.seamless, true);
});

test("the play loop stops cleanly at the end of the graph (contract 422)", async () => {
  const transport = new FakeTransport({ graph: { [OPEN]: seedGraph()[OPEN] } }); // only one beat
  const player = new BranchingPlayer({ transport, userId: "viewer-1", startBeatId: OPEN });
  const steps = await player.play();
  assert.equal(steps.length, 1);
  assert.equal(player.beatId, CUT_A); // advanced to the played cut, then hit 422
});
