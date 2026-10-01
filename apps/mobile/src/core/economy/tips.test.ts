import { test } from "node:test";
import assert from "node:assert/strict";
import { createTipsClient, isValidTip } from "./tips";
import { recordingFetch } from "../test-fetch";

test("guests cannot tip: no request is sent", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200, body: {} }));
  const t = createTipsClient("https://eco", { getAccessToken: () => null, fetch: fetchImpl });
  assert.deepEqual(await t.sendTip("v1", 10), { status: "auth_required" });
  assert.equal(calls.length, 0);
});

test("signed-in tip posts { video_id, coins } with bearer and idempotency key, no user id", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 201, body: { ok: true } }));
  const t = createTipsClient("https://eco/", { getAccessToken: () => "tok", fetch: fetchImpl, newId: () => "key-1" });
  assert.deepEqual(await t.sendTip("v1", 50), { status: "sent" });
  assert.equal(calls[0].url, "https://eco/tips");
  assert.deepEqual(calls[0].body, { video_id: "v1", coins: 50 });
  assert.equal(calls[0].headers.authorization, "Bearer tok");
  assert.equal(calls[0].headers["idempotency-key"], "key-1");
});

test("404 means coming soon, 402 insufficient funds, 500 error", async () => {
  for (const [status, expected] of [[404, "coming_soon"], [402, "insufficient_funds"], [500, "error"], [401, "auth_required"]] as const) {
    const { fetchImpl } = recordingFetch(() => ({ status }));
    const t = createTipsClient("https://eco", { getAccessToken: () => "tok", fetch: fetchImpl });
    assert.equal((await t.sendTip("v1", 10)).status, expected);
  }
});

test("invalid coin amounts are rejected locally", async () => {
  assert.equal(isValidTip(0), false);
  assert.equal(isValidTip(1.5), false);
  assert.equal(isValidTip(-5), false);
  assert.equal(isValidTip(10), true);
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200 }));
  const t = createTipsClient("https://eco", { getAccessToken: () => "tok", fetch: fetchImpl });
  assert.equal((await t.sendTip("v1", 0)).status, "invalid");
  assert.equal(calls.length, 0);
});
