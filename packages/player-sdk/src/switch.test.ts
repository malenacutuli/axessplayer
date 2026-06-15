// Unit tests for the branch-point switch DECISION. Cover the whole fallback ladder: control cut,
// low-bandwidth hold, chosen-not-buffered degrade, and the seamless happy path. Pure logic, no IO.
// Runner: node --test + tsx. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PrefetchBuffer } from "./prefetch.js";
import { decideSwitch } from "./switch.js";
import { FakeTransport } from "./test-graph.js";
import type { DecideResponse } from "./types.js";

const CHOSEN = "aaaaaaaa-0000-0000-0000-00000000000a";
const DEFAULT = "dddddddd-0000-0000-0000-00000000000d";

function decision(over: Partial<DecideResponse> = {}): DecideResponse {
  return {
    decision_id: "dec-test",
    next_variant_id: CHOSEN,
    prefetch_variant_ids: [],
    is_control: false,
    policy_version: "fake-v0",
    ...over,
  };
}

// Build a buffer pre-loaded with the given variant ids.
async function bufferWith(ids: string[]): Promise<PrefetchBuffer> {
  const transport = new FakeTransport({ graph: {}, knownVariants: new Set(ids) });
  const buffer = new PrefetchBuffer(transport, { now: () => 1 });
  for (const id of ids) {
    await buffer.prefetch(decision({ next_variant_id: id, prefetch_variant_ids: [] }));
  }
  return buffer;
}

test("happy path: chosen cut buffered -> seamless switch to it", async () => {
  const buffer = await bufferWith([CHOSEN]);
  const d = decideSwitch({ decision: decision(), buffer, defaultVariantId: DEFAULT });
  assert.equal(d.variantId, CHOSEN);
  assert.equal(d.reason, "chosen");
  assert.equal(d.seamless, true);
});

test("control viewer: serve the engine's deterministic cut, reason control", async () => {
  const buffer = await bufferWith([CHOSEN]);
  const d = decideSwitch({
    decision: decision({ is_control: true }),
    buffer,
    defaultVariantId: DEFAULT,
  });
  assert.equal(d.variantId, CHOSEN);
  assert.equal(d.reason, "control");
  assert.equal(d.seamless, true);
});

test("chosen cut not buffered: degrade to the default cut, never a spinner", async () => {
  const buffer = await bufferWith([DEFAULT]); // chosen was NOT prefetched in time
  const d = decideSwitch({ decision: decision(), buffer, defaultVariantId: DEFAULT });
  assert.equal(d.variantId, DEFAULT);
  assert.equal(d.reason, "fallback_not_buffered");
  assert.equal(d.seamless, true); // default was buffered, so still no stall
});

test("low bandwidth: hold the safe default even though the chosen cut is buffered", async () => {
  const buffer = await bufferWith([CHOSEN, DEFAULT]);
  const d = decideSwitch({
    decision: decision(),
    buffer,
    defaultVariantId: DEFAULT,
    estimatedKbps: 100,
    bandwidthFloorKbps: 600,
  });
  assert.equal(d.variantId, DEFAULT);
  assert.equal(d.reason, "fallback_low_bandwidth");
});

test("bandwidth above floor: takes the seamless chosen switch", async () => {
  const buffer = await bufferWith([CHOSEN, DEFAULT]);
  const d = decideSwitch({
    decision: decision(),
    buffer,
    defaultVariantId: DEFAULT,
    estimatedKbps: 5000,
    bandwidthFloorKbps: 600,
  });
  assert.equal(d.variantId, CHOSEN);
  assert.equal(d.reason, "chosen");
});

test("unknown bandwidth is treated as adequate", async () => {
  const buffer = await bufferWith([CHOSEN]);
  const d = decideSwitch({
    decision: decision(),
    buffer,
    defaultVariantId: DEFAULT,
    estimatedKbps: undefined,
  });
  assert.equal(d.reason, "chosen");
});
