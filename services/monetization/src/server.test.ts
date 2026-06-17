// Spec test for the grant settlement surface. A verified reward or paid test-mode checkout settles to the
// ledger sink with the right idempotent grant; an unverified reward or a livemode Stripe session never
// settles. The sink is a fake, so no money moves. No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createSettlementServer, type GrantSink } from "./server.js";
import type { GrantRequest } from "./grant.js";

const grants: GrantRequest[] = [];
const sink: GrantSink = {
  async grant(req) {
    grants.push(req);
    return { balance: grants.reduce((s, g) => s + g.amount, 0) };
  },
};

let base: string;
const server = createSettlementServer(sink);
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });

describe("grant settlement surface", () => {
  it("settles a verified rewarded ad with the impression-keyed grant", async () => {
    const r = await (await post("/reward/ad", { userId: "u1", impressionId: "imp-1", verified: true })).json();
    assert.equal(r.granted, true);
    assert.equal(r.client_txn_id, "ad:imp-1");
    assert.equal(r.type, "rewarded_ad");
  });
  it("does not settle an unverified ad", async () => {
    const r = await (await post("/reward/ad", { userId: "u1", impressionId: "imp-2", verified: false })).json();
    assert.equal(r.granted, false);
    assert.match(r.skipped, /not verified/);
  });
  it("settles a daily check-in (server-dated, once per day at the ledger)", async () => {
    const r = await (await post("/reward/checkin", { userId: "u1" })).json();
    assert.equal(r.granted, true);
    assert.equal(r.type, "checkin");
    assert.match(r.client_txn_id, /^checkin:u1:\d{4}-\d{2}-\d{2}$/);
  });
  it("settles a paid TEST-mode Stripe checkout to an IAP grant", async () => {
    const session = { id: "cs_test_9", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_medium" } };
    const r = await (await post("/stripe/webhook", session)).json();
    assert.equal(r.granted, true);
    assert.equal(r.type, "iap");
    assert.equal(r.amount, 120);
    assert.equal(r.client_txn_id, "stripe:cs_test_9");
  });
  it("refuses a livemode Stripe session (test mode only until the live key is enabled)", async () => {
    const session = { id: "cs_live_1", payment_status: "paid", livemode: true, metadata: { userId: "u1", offerId: "pack_small" } };
    const r = await (await post("/stripe/webhook", session)).json();
    assert.equal(r.granted, false);
    assert.match(r.skipped, /livemode/);
  });
});
