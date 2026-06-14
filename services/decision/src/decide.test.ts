// Tests for the walking-skeleton decision policy and handler.
// Runner: node --test with tsx (works on Node 20 CI and on local Node with native type stripping).
// Keeps the NodeNext .js import specifiers; tsx resolves them to the .ts sources. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assignControl, chooseBranch, DIRECTORS_CUT, type Candidate } from "./policy.js";
import { handleDecide, POLICY_VERSION, type DecisionDB } from "./decide.js";

const candidates: Candidate[] = [
  { variantId: "cccccccc-0000-0000-0000-00000000000a", branch: "calm" },
  { variantId: "cccccccc-0000-0000-0000-00000000000b", branch: "tense" },
];

test("assignControl is stable per user", () => {
  assert.equal(assignControl("user-123"), assignControl("user-123"));
});

test("assignControl keeps a roughly bounded control share", () => {
  let control = 0;
  for (let i = 0; i < 2000; i++) if (assignControl("u" + i, 10)) control++;
  // Nominal 10 percent. On a finite id sample it lands near, not exactly, 10 percent.
  assert.ok(control > 120 && control < 290, `control share out of range: ${control}/2000`);
});

test("control always gets the director's cut", () => {
  assert.equal(chooseBranch(candidates, { intensity: 5 }, true).branch, DIRECTORS_CUT);
});

test("treatment, high intensity, gets tense", () => {
  assert.equal(chooseBranch(candidates, { intensity: 5 }, false).branch, "tense");
});

test("treatment, low intensity, gets calm", () => {
  assert.equal(chooseBranch(candidates, { intensity: 2 }, false).branch, "calm");
});

test("unknown viewer state falls back to calm", () => {
  assert.equal(chooseBranch(candidates, {}, false).branch, "calm");
});

function fakeDB(intensity: number): DecisionDB {
  return {
    seriesOfBeat: async () => "11111111-1111-1111-1111-111111111111",
    successorsOf: async () => candidates,
    viewerState: async () => ({ intensity }),
    logDecision: async () => "dddddddd-0000-0000-0000-000000000001",
  };
}

test("handler returns decision_id, a chosen variant, prefetch hints, and policy version", async () => {
  const res = await handleDecide(
    { user_id: "treatment-fixed", current_beat_id: "bbbbbbbb-0000-0000-0000-000000000002" },
    fakeDB(5)
  );
  assert.ok(res.decision_id);
  assert.ok(res.next_variant_id);
  assert.equal(res.prefetch_variant_ids.length, 2);
  assert.equal(res.policy_version, POLICY_VERSION);
  assert.equal(typeof res.is_control, "boolean");
});

test("handler throws at the end of the graph", async () => {
  const emptyDB: DecisionDB = {
    seriesOfBeat: async () => "s",
    successorsOf: async () => [],
    viewerState: async () => ({}),
    logDecision: async () => "x",
  };
  await assert.rejects(
    handleDecide({ user_id: "u", current_beat_id: "end" }, emptyDB),
    /no_successors/
  );
});
