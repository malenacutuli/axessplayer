// Unit tests for the predictive prefetch buffer with a fake transport. Cover: the prefetch plan
// (chosen first, hints de-duped, top-k cap), concurrent buffering, 404 misses dropped not fatal,
// re-use of already buffered cuts, and eviction between branch points. Runner: node --test + tsx
// (NodeNext .js specifiers resolve to .ts). No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PrefetchBuffer, prefetchPlan } from "./prefetch.js";
import { FakeTransport } from "./test-graph.js";
import type { DecideResponse } from "./types.js";

const A = "aaaaaaaa-0000-0000-0000-00000000000a";
const B = "bbbbbbbb-0000-0000-0000-00000000000b";
const C = "cccccccc-0000-0000-0000-00000000000c";
const D = "dddddddd-0000-0000-0000-00000000000d";
const MISSING = "eeeeeeee-0000-0000-0000-00000000000e";

function decision(over: Partial<DecideResponse> = {}): DecideResponse {
  return {
    decision_id: "dec-test",
    next_variant_id: A,
    prefetch_variant_ids: [B, C],
    is_control: false,
    policy_version: "fake-v0",
    ...over,
  };
}

test("prefetchPlan puts the chosen cut first, then hints, de-duped", () => {
  const plan = prefetchPlan(decision({ next_variant_id: A, prefetch_variant_ids: [A, B, C] }));
  assert.deepEqual(plan, [A, B, C]); // A appears once, chosen, at the front
});

test("prefetchPlan caps hints at topK to bound egress", () => {
  const plan = prefetchPlan(decision({ prefetch_variant_ids: [B, C, D] }), 2);
  assert.deepEqual(plan, [A, B, C]); // chosen + 2 hints, D dropped
});

test("prefetch buffers the chosen cut plus top-k hints concurrently", async () => {
  const transport = new FakeTransport({
    graph: {},
    knownVariants: new Set([A, B, C, D]),
  });
  const buffer = new PrefetchBuffer(transport, { topK: 3, now: () => 1 });
  const res = await buffer.prefetch(decision({ prefetch_variant_ids: [B, C] }));

  assert.deepEqual(
    res.buffered.map((b) => b.variantId),
    [A, B, C]
  );
  assert.deepEqual(res.missed, []);
  assert.equal(transport.calls.manifest, 3);
  assert.ok(buffer.has(A) && buffer.has(B) && buffer.has(C));
});

test("a 404 candidate is dropped as missed, not thrown", async () => {
  const transport = new FakeTransport({
    graph: {},
    knownVariants: new Set([A, B]), // C and MISSING are unknown -> 404
  });
  const buffer = new PrefetchBuffer(transport, { now: () => 1 });
  const res = await buffer.prefetch(decision({ prefetch_variant_ids: [B, MISSING] }));

  assert.deepEqual(
    res.buffered.map((b) => b.variantId),
    [A, B]
  );
  assert.deepEqual(res.missed, [MISSING]);
});

test("already buffered cuts are not re-fetched on the next decision", async () => {
  const transport = new FakeTransport({ graph: {}, knownVariants: new Set([A, B, C]) });
  const buffer = new PrefetchBuffer(transport, { now: () => 1 });

  await buffer.prefetch(decision({ prefetch_variant_ids: [B] }));
  assert.equal(transport.calls.manifest, 2); // A, B

  // A re-decide that lists A and B again plus a new C: only C is fetched.
  await buffer.prefetch(decision({ next_variant_id: A, prefetch_variant_ids: [B, C] }));
  assert.equal(transport.calls.manifest, 3); // only C added
});

test("evictExcept drops cuts we passed on, keeping the played cut", async () => {
  const transport = new FakeTransport({ graph: {}, knownVariants: new Set([A, B, C]) });
  const buffer = new PrefetchBuffer(transport, { now: () => 1 });
  await buffer.prefetch(decision({ prefetch_variant_ids: [B, C] }));
  assert.equal(buffer.size, 3);

  buffer.evictExcept([A]);
  assert.equal(buffer.size, 1);
  assert.ok(buffer.has(A));
  assert.ok(!buffer.has(B) && !buffer.has(C));
});
