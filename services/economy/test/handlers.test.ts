// Handler tests for /wallet and /spend, against the real hardened spend_coins on PGlite (fast suite).
// Proves the F1 boundary structurally: identity is the handler parameter, the body has no user_id, and
// the wallet charged is whichever session id the handler was given. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, FIX } from "./harness.js";
import { handleGetWallet, handleSpend, type EconomyDB, type Scope } from "../src/economy.js";

// PGlite-backed EconomyDB. The production adapter (pgEconomyDb.ts) is the same shape over node-postgres.
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
  };
}

const SPEND = (scope_id: string, client_txn_id: string, scope: Scope = "beat_variant") => ({
  scope,
  scope_id,
  client_txn_id,
});

test("GET /wallet returns the session user's balance and entitlements", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const res = await handleGetWallet(FIX.userHigh, db);
  assert.equal(res.status, 200);
  const w = res.body as { balance: number; entitlements: unknown[] };
  assert.equal(w.balance, 10);
  assert.deepEqual(w.entitlements, []);
});

test("GET /wallet returns 404 when the session user has no wallet", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const res = await handleGetWallet("aaaaaaaa-0000-0000-0000-0000000000ee", db);
  assert.equal(res.status, 404);
});

test("POST /spend success returns 200 with the new balance and the entitlement", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const res = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, "h1"), db);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    balance: 5,
    entitlement: { scope: "beat_variant", scope_id: FIX.premiumEnding },
  });
  const after = await handleGetWallet(FIX.userHigh, db);
  assert.equal((after.body as { balance: number }).balance, 5);
});

test("F1: the acting user is the handler parameter, not anything in the body", async () => {
  const raw = await freshDb();
  const db = pgliteEconomyDb(raw);
  // Spend as userLow. Only userLow's wallet may move; userHigh must be untouched. There is no body field
  // that could redirect the charge, because identity is the parameter.
  await handleSpend(FIX.userLow, SPEND(FIX.premiumEnding, "low-1"), db);
  assert.equal((await handleGetWallet(FIX.userLow, db)).body && (await handleGetWallet(FIX.userLow, db)).status, 200);
  const low = await handleGetWallet(FIX.userLow, db);
  const high = await handleGetWallet(FIX.userHigh, db);
  assert.equal((low.body as { balance: number }).balance, 5, "userLow charged");
  assert.equal((high.body as { balance: number }).balance, 10, "userHigh untouched");
});

test("POST /spend insufficient funds maps to 402 with paywall options", async () => {
  const raw = await freshDb();
  await raw.query("update coin_wallet set balance = 3, bonus_balance = 0 where user_id = $1", [FIX.userHigh]);
  const db = pgliteEconomyDb(raw);
  const res = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, "h-insuf"), db);
  assert.equal(res.status, 402);
  const b = res.body as { error: string; options: string[] };
  assert.equal(b.error, "insufficient_funds");
  assert.ok(b.options.includes("buy"));
});

test("POST /spend unknown scope_id maps to 404", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const res = await handleSpend(FIX.userHigh, SPEND("cccccccc-0000-0000-0000-0000000000ff", "h-unk"), db);
  assert.equal(res.status, 404);
  assert.equal((res.body as { error: string }).error, "unknown_scope_id");
});

test("POST /spend rejects a bad scope and a missing txn id before touching the DB", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const bad = await handleSpend(FIX.userHigh, { scope: "nope" as Scope, scope_id: FIX.premiumEnding, client_txn_id: "x" }, db);
  assert.equal(bad.status, 400);
  const noTxn = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, ""), db);
  assert.equal(noTxn.status, 400);
});

test("POST /spend idempotent replay and own-once both return 200, charged once", async () => {
  const db = pgliteEconomyDb(await freshDb());
  const a = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, "same"), db);
  const b = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, "same"), db); // replay
  const c = await handleSpend(FIX.userHigh, SPEND(FIX.premiumEnding, "different"), db); // own-once
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);
  assert.equal((await handleGetWallet(FIX.userHigh, db)).body && (await handleGetWallet(FIX.userHigh, db)).status, 200);
  assert.equal(((await handleGetWallet(FIX.userHigh, db)).body as { balance: number }).balance, 5, "charged exactly once");
});
