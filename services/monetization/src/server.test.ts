// Spec test for the grant settlement surface. A verified reward or paid test-mode checkout settles to the
// ledger sink with the right idempotent grant; an unverified reward or a livemode Stripe session never
// settles. The sink is a fake, so no money moves. No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
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
const WHSEC = "whsec_test_secret";
// Fake session verifier: "tok-<user>" is a valid session for <user>; anything else is unauthenticated.
const sessionVerifier = { verifySession: async (t: string | null) => (t && t.startsWith("tok-") ? { userId: t.slice(4) } : null) };
const server = createSettlementServer(sink, { stripeWebhookSecret: WHSEC, sessionVerifier });
const unconfigured = createSettlementServer(sink);
let unconfiguredBase: string;
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((r) => unconfigured.listen(0, "127.0.0.1", r));
  unconfiguredBase = `http://127.0.0.1:${(unconfigured.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  unconfigured.close();
});

const post = (path: string, body: unknown, token: string | null = "tok-u1", at = base) =>
  fetch(`${at}${path}`, { method: "POST", body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });

// A Stripe-shaped signed webhook delivery: Event wrapper + Stripe-Signature over "<t>.<raw body>".
const sign = (raw: string, secret = WHSEC, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
const event = (session: unknown, type = "checkout.session.completed") => JSON.stringify({ id: "evt_1", type, data: { object: session } });
const webhook = (raw: string, signature?: string, at = base) =>
  fetch(`${at}/stripe/webhook`, { method: "POST", body: raw, headers: signature ? { "stripe-signature": signature } : {} });

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
  it("refuses reward routes without a valid session", async () => {
    const before = grants.length;
    for (const path of ["/reward/ad", "/reward/checkin", "/reward/follow"]) {
      assert.equal((await post(path, { userId: "u1", impressionId: "imp-x", verified: true }, null)).status, 401);
      assert.equal((await post(path, { userId: "u1", impressionId: "imp-y", verified: true }, "forged")).status, 401);
    }
    assert.equal(grants.length, before);
  });
  it("credits the session user, never a userId from the body", async () => {
    const r = await (await post("/reward/follow", { userId: "victim" }, "tok-attacker")).json();
    assert.equal(r.granted, true);
    assert.equal(grants.at(-1)?.userId, "attacker");
    assert.equal(r.client_txn_id, "follow:attacker");
  });
  it("closes the reward routes with 503 when no session verifier is configured", async () => {
    assert.equal((await post("/reward/checkin", {}, "tok-u1", unconfiguredBase)).status, 503);
  });
  it("settles a paid TEST-mode Stripe checkout to an IAP grant", async () => {
    const session = { id: "cs_test_9", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_medium" } };
    const raw = event(session);
    const r = await (await webhook(raw, sign(raw))).json();
    assert.equal(r.granted, true);
    assert.equal(r.type, "iap");
    assert.equal(r.amount, 120);
    assert.equal(r.client_txn_id, "stripe:cs_test_9");
  });
  it("refuses a livemode Stripe session (test mode only until the live key is enabled)", async () => {
    const session = { id: "cs_live_1", payment_status: "paid", livemode: true, metadata: { userId: "u1", offerId: "pack_small" } };
    const raw = event(session);
    const r = await (await webhook(raw, sign(raw))).json();
    assert.equal(r.granted, false);
    assert.match(r.skipped, /livemode/);
  });
  it("refuses an unsigned webhook and never grants", async () => {
    const before = grants.length;
    const raw = event({ id: "cs_test_forged", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_large" } });
    const res = await webhook(raw);
    assert.equal(res.status, 400);
    assert.equal(grants.length, before);
  });
  it("refuses a webhook signed with the wrong secret", async () => {
    const raw = event({ id: "cs_test_x", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_small" } });
    assert.equal((await webhook(raw, sign(raw, "whsec_wrong"))).status, 400);
  });
  it("refuses a body tampered after signing", async () => {
    const raw = event({ id: "cs_test_y", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_small" } });
    const tampered = raw.replace("pack_small", "pack_large");
    assert.equal((await webhook(tampered, sign(raw))).status, 400);
  });
  it("refuses a replayed signature older than the tolerance window", async () => {
    const raw = event({ id: "cs_test_z", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_small" } });
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal((await webhook(raw, sign(raw, WHSEC, old))).status, 400);
  });
  it("ignores other signed event types without granting", async () => {
    const before = grants.length;
    const raw = event({ id: "cs_test_e" }, "checkout.session.expired");
    const r = await (await webhook(raw, sign(raw))).json();
    assert.equal(r.granted, false);
    assert.equal(grants.length, before);
  });
  it("fails closed with 503 when no signing secret is configured", async () => {
    const raw = event({ id: "cs_test_n", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_small" } });
    assert.equal((await webhook(raw, sign(raw), unconfiguredBase)).status, 503);
  });
});

describe("paywall presentation identity", () => {
  const logged: Array<{ userId: string }> = [];
  const pw = createSettlementServer(sink, {
    sessionVerifier,
    logPaywall: async (e) => {
      logged.push({ userId: e.userId });
    },
  });
  let pwBase: string;
  before(async () => {
    await new Promise<void>((r) => pw.listen(0, "127.0.0.1", r));
    pwBase = `http://127.0.0.1:${(pw.address() as AddressInfo).port}`;
  });
  after(() => pw.close());

  it("serves a guest a paywall without logging anything for them", async () => {
    const res = await post("/paywall/present", { userId: "someone-else", beatVariantId: "v1" }, null, pwBase);
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as { path?: string }).path);
    assert.equal(logged.length, 0);
  });
  it("logs a signed-in viewer under the session subject, never the body userId", async () => {
    const res = await post("/paywall/present", { userId: "victim", beatVariantId: "v1" }, "tok-viewer", pwBase);
    assert.equal(res.status, 200);
    assert.deepEqual(logged.at(-1), { userId: "viewer" });
  });
  it("refuses a present-but-invalid token", async () => {
    assert.equal((await post("/paywall/present", { beatVariantId: "v1" }, "forged", pwBase)).status, 401);
  });
});
