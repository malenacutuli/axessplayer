// Route tests for the economy HTTP adapter, exercising the real Hono app over the real hardened
// spend_coins/grant_coins on PGlite. These prove the transport and the F1 trust boundary, not the
// ledger math (handlers.test.ts and spend_coins.test.ts cover that):
//
//   - /wallet self-scopes to the session token subject; a different token sees a different wallet.
//   - /spend takes identity from the token, never the body; a user_id smuggled into the body is ignored.
//   - /spend maps insufficient funds to 402 with paywall options.
//   - /grant returns 403 without the service role, and 200 with it.
//   - missing/invalid session token is 401.
//
// Auth uses the TEST verifiers (testVerifiers): session token "session:<uuid>" resolves to that uuid;
// the service role is a fixed secret. Real JWT/JWKS verification is a flagged stub behind the verifier
// interface; it is not exercised here. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, FIX } from "./harness.js";
import type { EconomyDB, Scope } from "../src/economy.js";
import { createEconomyApp } from "../src/http/app.js";
import { testVerifiers } from "../src/http/auth.js";

const SERVICE_SECRET = "test-service-role-secret";

// PGlite-backed EconomyDB, same shape as the production PgEconomyDb (node-postgres) and the handler tests.
function pgliteEconomyDb(db: Awaited<ReturnType<typeof freshDb>>): EconomyDB {
  return {
    async getWallet(userId) {
      const w = await db.query<{ balance: number; bonus_balance: number }>(
        "select balance, bonus_balance from coin_wallet where user_id = $1",
        [userId]
      );
      if (w.rows.length === 0) return null;
      const e = await db.query<{ scope: string; scope_id: string }>(
        "select scope, scope_id from entitlements where user_id = $1 order by granted_at",
        [userId]
      );
      return {
        user_id: userId,
        balance: Number(w.rows[0].balance),
        bonus_balance: Number(w.rows[0].bonus_balance),
        entitlements: e.rows.map((r) => ({ scope: r.scope as Scope, scope_id: r.scope_id })),
      };
    },
    async spend(userId, scope, scopeId, clientTxnId) {
      const r = await db.query<{ total: number }>("select spend_coins($1,$2,$3,$4) as total", [
        userId,
        scope,
        scopeId,
        clientTxnId,
      ]);
      return Number(r.rows[0].total);
    },
    async grant(userId, amount, type, clientTxnId) {
      const r = await db.query<{ total: number }>("select grant_coins($1,$2,$3,$4) as total", [
        userId,
        amount,
        type,
        clientTxnId,
      ]);
      return Number(r.rows[0].total);
    },
  };
}

async function appFor(db: Awaited<ReturnType<typeof freshDb>>) {
  return createEconomyApp({ db: pgliteEconomyDb(db), verifiers: testVerifiers(SERVICE_SECRET) });
}

const sessionToken = (userId: string) => `Bearer session:${userId}`;
const serviceToken = `Bearer ${SERVICE_SECRET}`;

test("GET /wallet self-scopes to the session token subject", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/wallet", {
    headers: { authorization: sessionToken(FIX.userHigh) },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user_id: string; balance: number; entitlements: unknown[] };
  assert.equal(body.user_id, FIX.userHigh);
  assert.equal(body.balance, 10);
  assert.deepEqual(body.entitlements, []);
});

test("GET /wallet for a different token returns that other user's wallet, not the first", async () => {
  const app = await appFor(await freshDb());
  const low = await app.request("/wallet", { headers: { authorization: sessionToken(FIX.userLow) } });
  const body = (await low.json()) as { user_id: string };
  assert.equal(body.user_id, FIX.userLow);
});

test("GET /wallet without a token is 401", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/wallet");
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, "unauthorized");
});

test("GET /wallet with a malformed token is 401", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/wallet", { headers: { authorization: "Bearer not-a-session-token" } });
  assert.equal(res.status, 401);
});

test("POST /spend success returns 200 with the new balance and entitlement", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/spend", {
    method: "POST",
    headers: { authorization: sessionToken(FIX.userHigh), "content-type": "application/json" },
    body: JSON.stringify({ scope: "beat_variant", scope_id: FIX.premiumEnding, client_txn_id: "h1" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    balance: 5,
    entitlement: { scope: "beat_variant", scope_id: FIX.premiumEnding },
  });
});

test("POST /spend takes identity from the token and ignores a user_id smuggled in the body (F1)", async () => {
  const db = await freshDb();
  const app = await appFor(db);
  // Caller is userLow per the token. The body tries to charge userHigh. Only userLow may move.
  const res = await app.request("/spend", {
    method: "POST",
    headers: { authorization: sessionToken(FIX.userLow), "content-type": "application/json" },
    body: JSON.stringify({
      user_id: FIX.userHigh,
      scope: "beat_variant",
      scope_id: FIX.premiumEnding,
      client_txn_id: "low-1",
    }),
  });
  assert.equal(res.status, 200);

  const low = await app.request("/wallet", { headers: { authorization: sessionToken(FIX.userLow) } });
  const high = await app.request("/wallet", { headers: { authorization: sessionToken(FIX.userHigh) } });
  assert.equal(((await low.json()) as { balance: number }).balance, 5, "userLow (the token) was charged");
  assert.equal(((await high.json()) as { balance: number }).balance, 10, "userHigh (the body) was untouched");
});

test("POST /spend insufficient funds maps to 402 with paywall options", async () => {
  const db = await freshDb();
  await db.query("update coin_wallet set balance = 3, bonus_balance = 0 where user_id = $1", [FIX.userHigh]);
  const app = await appFor(db);
  const res = await app.request("/spend", {
    method: "POST",
    headers: { authorization: sessionToken(FIX.userHigh), "content-type": "application/json" },
    body: JSON.stringify({ scope: "beat_variant", scope_id: FIX.premiumEnding, client_txn_id: "h-insuf" }),
  });
  assert.equal(res.status, 402);
  const body = (await res.json()) as { error: string; options: string[] };
  assert.equal(body.error, "insufficient_funds");
  assert.ok(body.options.includes("buy"));
  assert.ok(body.options.includes("watch_ad"));
  assert.ok(body.options.includes("subscribe"));
});

test("POST /spend without a token is 401, before any DB access", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/spend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "beat_variant", scope_id: FIX.premiumEnding, client_txn_id: "noauth" }),
  });
  assert.equal(res.status, 401);
});

test("POST /spend with a bad scope is 400", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/spend", {
    method: "POST",
    headers: { authorization: sessionToken(FIX.userHigh), "content-type": "application/json" },
    body: JSON.stringify({ scope: "nope", scope_id: FIX.premiumEnding, client_txn_id: "bad" }),
  });
  assert.equal(res.status, 400);
});

test("POST /grant is 403 without the service role, even with a valid session token", async () => {
  const app = await appFor(await freshDb());
  const withSession = await app.request("/grant", {
    method: "POST",
    headers: { authorization: sessionToken(FIX.userHigh), "content-type": "application/json" },
    body: JSON.stringify({ user_id: FIX.userHigh, amount: 20, type: "iap", client_txn_id: "g-403" }),
  });
  assert.equal(withSession.status, 403, "a client session token cannot reach /grant");

  const noAuth = await app.request("/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: FIX.userHigh, amount: 20, type: "iap", client_txn_id: "g-403b" }),
  });
  assert.equal(noAuth.status, 403);

  // And nothing was credited: userHigh is still at the seeded 10.
  const w = await app.request("/wallet", { headers: { authorization: sessionToken(FIX.userHigh) } });
  assert.equal(((await w.json()) as { balance: number }).balance, 10, "no grant applied without the service role");
});

test("POST /grant with the service role returns 200 and the new balance", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/grant", {
    method: "POST",
    headers: { authorization: serviceToken, "content-type": "application/json" },
    body: JSON.stringify({ user_id: FIX.userHigh, amount: 20, type: "iap", client_txn_id: "g-ok" }),
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { balance: number }).balance, 30, "10 + 20");
});

test("POST /grant with the service role validates the body (400 on bad type)", async () => {
  const app = await appFor(await freshDb());
  const res = await app.request("/grant", {
    method: "POST",
    headers: { authorization: serviceToken, "content-type": "application/json" },
    body: JSON.stringify({ user_id: FIX.userHigh, amount: 5, type: "free_money", client_txn_id: "g-badtype" }),
  });
  assert.equal(res.status, 400);
});
