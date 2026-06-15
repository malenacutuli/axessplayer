// API client tests: the client attaches the session bearer, maps 401 -> AuthRequiredError and 402 ->
// PaywallRequiredError (with the contract options), and F1: a /spend body carries scope + scope_id +
// client_txn_id and NEVER a user_id, and the runtime guard rejects any forbidden identity key. The
// integration F1 assertion (over the wire) lives in integration/unlock.test.ts. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertNoForbiddenKeys,
  AuthRequiredError,
  createApiClient,
  PaywallRequiredError,
} from "./client.js";
import { singleOrigin } from "./config.js";

// A fetch fake that records the last request and returns a scripted response.
function scriptedFetch(
  status: number,
  body: unknown,
  sink?: { url?: string; init?: RequestInit }
): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (sink) {
      sink.url = String(url);
      sink.init = init;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

test("getWallet attaches the bearer and returns the server wallet", async () => {
  const sink: { init?: RequestInit } = {};
  const client = createApiClient(
    singleOrigin(
      "http://x",
      () => "tok-123",
      scriptedFetch(200, { user_id: "u", balance: 5, bonus_balance: 0, entitlements: [] }, sink)
    )
  );
  const w = await client.getWallet();
  assert.equal(w.balance, 5);
  const auth = new Headers(sink.init?.headers).get("authorization");
  assert.equal(auth, "Bearer tok-123");
});

test("spend sends scope + scope_id + client_txn_id and NO user_id (F1)", async () => {
  const sink: { init?: RequestInit } = {};
  const client = createApiClient(
    singleOrigin(
      "http://x",
      () => "tok",
      scriptedFetch(200, { balance: 0, entitlement: { scope: "episode", scope_id: "e" } }, sink)
    )
  );
  await client.spend({ scope: "episode", scope_id: "e", client_txn_id: "t1" });
  const sent = JSON.parse(String(sink.init?.body));
  assert.deepEqual(Object.keys(sent).sort(), ["client_txn_id", "scope", "scope_id"]);
  assert.equal("user_id" in sent, false);
});

test("a 401 surfaces AuthRequiredError", async () => {
  const client = createApiClient(singleOrigin("http://x", () => "tok", scriptedFetch(401, { error: "x" })));
  await assert.rejects(() => client.getWallet(), AuthRequiredError);
});

test("a missing bearer surfaces AuthRequiredError before any request", async () => {
  let called = false;
  const f = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof globalThis.fetch;
  const client = createApiClient(singleOrigin("http://x", () => null, f));
  await assert.rejects(() => client.getWallet(), AuthRequiredError);
  assert.equal(called, false);
});

test("a 402 surfaces PaywallRequiredError carrying the contract options", async () => {
  const client = createApiClient(
    singleOrigin(
      "http://x",
      () => "tok",
      scriptedFetch(402, { error: "insufficient_funds", options: ["buy", "watch_ad", "subscribe"] })
    )
  );
  await assert.rejects(
    () => client.spend({ scope: "episode", scope_id: "e", client_txn_id: "t" }),
    (err) => {
      assert.ok(err instanceof PaywallRequiredError);
      assert.deepEqual(err.options.options, ["buy", "watch_ad", "subscribe"]);
      return true;
    }
  );
});

test("the F1 runtime guard rejects any forbidden identity key in a body", () => {
  assert.throws(() => assertNoForbiddenKeys({ user_id: "x" }), /F1 violation/);
  assert.throws(() => assertNoForbiddenKeys({ sub: "x" }), /F1 violation/);
  assert.doesNotThrow(() => assertNoForbiddenKeys({ scope: "episode", scope_id: "e", client_txn_id: "t" }));
});
