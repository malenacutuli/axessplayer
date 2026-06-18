// The cutover gate: starting under NODE_ENV=production with the test verifier is a HARD stop, so an
// unverified token scheme can never reach the live plane. Mirrors decision/economy/ingestion. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectVerifier, buildDeps } from "../src/httpServer.js";

test("selectVerifier refuses the test verifier under NODE_ENV=production", () => {
  assert.throws(() => selectVerifier({ nodeEnv: "production" }), /cutover gate/);
});

test("selectVerifier returns the test verifier outside production", async () => {
  const v = selectVerifier({ nodeEnv: "test" });
  const id = await v.verifySession("session:11111111-1111-1111-1111-111111111111");
  assert.deepEqual(id, { userId: "11111111-1111-1111-1111-111111111111" });
});

test("buildDeps ships the unwired in-memory store (nothing persisted to the hosted DB)", () => {
  const deps = buildDeps({ nodeEnv: "test" });
  assert.equal(deps.store.wired, false);
});
