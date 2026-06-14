// Behavioral spec for spend_coins (0002_spend_rpc.sql) against migrations + seed.
// This is a behavioral contract, not a security review: it proves what the function does,
// not that the function is safe to merge. The W2 security-review subagent + human sign-off
// still gate the merge (see 0002 header and 05_SECURITY_AND_COMPLIANCE.md). No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, FIX, spend, walletTotal, walletParts, countRows } from "./harness.js";

test("seed lands: both users hold 10 coins and the premium ending costs 5", async () => {
  const db = await freshDb();
  assert.equal(await walletTotal(db, FIX.userHigh), 10);
  assert.equal(await walletTotal(db, FIX.userLow), 10);
  const cost = await countRows(
    db,
    "select coin_cost as n from beat_variants where id = $1",
    [FIX.premiumEnding]
  );
  assert.equal(cost, 5);
});

test("a premium unlock deducts the server price exactly once and grants the entitlement", async () => {
  const db = await freshDb();
  const newTotal = await spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "txn-A");
  assert.equal(newTotal, 5, "returns the new total balance");
  assert.equal(await walletTotal(db, FIX.userHigh), 5, "wallet went 10 -> 5");

  const txns = await countRows(
    db,
    "select count(*) as n from coin_transactions where user_id = $1 and client_txn_id = 'txn-A'",
    [FIX.userHigh]
  );
  assert.equal(txns, 1, "exactly one ledger row");

  const spendRow = await db.query<{ amount: number; type: string }>(
    "select amount::int as amount, type from coin_transactions where user_id = $1 and client_txn_id = 'txn-A'",
    [FIX.userHigh]
  );
  assert.equal(spendRow.rows[0].amount, -5, "ledger amount is the negated server price");
  assert.equal(spendRow.rows[0].type, "spend");

  const ents = await countRows(
    db,
    "select count(*) as n from entitlements where user_id = $1 and scope = 'beat_variant' and scope_id = $2",
    [FIX.userHigh, FIX.premiumEnding]
  );
  assert.equal(ents, 1, "entitlement granted");
});

test("replaying the same client_txn_id is a no-op (idempotency)", async () => {
  const db = await freshDb();
  const first = await spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "txn-DUP");
  const second = await spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "txn-DUP");
  assert.equal(first, 5);
  assert.equal(second, 5, "replay returns the current total, no further deduction");
  assert.equal(await walletTotal(db, FIX.userHigh), 5, "still 5, not 0");

  assert.equal(
    await countRows(
      db,
      "select count(*) as n from coin_transactions where user_id = $1 and client_txn_id = 'txn-DUP'",
      [FIX.userHigh]
    ),
    1,
    "still exactly one ledger row after the replay"
  );
  assert.equal(
    await countRows(
      db,
      "select count(*) as n from entitlements where user_id = $1 and scope_id = $2",
      [FIX.userHigh, FIX.premiumEnding]
    ),
    1,
    "still exactly one entitlement after the replay"
  );
});

test("price is server-derived: the client cannot smuggle a price (it passes no price at all)", async () => {
  // The RPC signature has no price parameter. Spending the free ending (coin_cost 0) deducts nothing,
  // proving the cost is read from the row, not supplied by the caller.
  const db = await freshDb();
  const total = await spend(db, FIX.userLow, "beat_variant", FIX.freeEnding, "txn-FREE");
  assert.equal(total, 10, "free variant deducts 0");
  assert.equal(await walletTotal(db, FIX.userLow), 10);
});

test("bonus coins are spent before the main balance", async () => {
  const db = await freshDb();
  // Give userLow 3 bonus on top of the seeded 10 main, then spend the 5-coin premium.
  await db.exec(
    "update coin_wallet set bonus_balance = 3 where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'"
  );
  const total = await spend(db, FIX.userLow, "beat_variant", FIX.premiumEnding, "txn-BONUS");
  assert.equal(total, 8, "13 total minus 5 = 8");
  const { balance, bonus } = await walletParts(db, FIX.userLow);
  assert.equal(bonus, 0, "all 3 bonus spent first");
  assert.equal(balance, 8, "then 2 from main: 10 - 2 = 8");
});

test("draining to zero then spending again raises insufficient_funds", async () => {
  const db = await freshDb();
  await spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "drain-1"); // 10 -> 5
  await spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "drain-2"); // 5 -> 0
  assert.equal(await walletTotal(db, FIX.userHigh), 0);
  await assert.rejects(
    spend(db, FIX.userHigh, "beat_variant", FIX.premiumEnding, "drain-3"),
    /insufficient_funds/
  );
  // The failed spend left no partial ledger row behind.
  assert.equal(
    await countRows(
      db,
      "select count(*) as n from coin_transactions where user_id = $1 and client_txn_id = 'drain-3'",
      [FIX.userHigh]
    ),
    0,
    "no ledger row written on a rejected spend"
  );
});

test("unknown scope id raises unknown_scope_id", async () => {
  const db = await freshDb();
  await assert.rejects(
    spend(db, FIX.userHigh, "beat_variant", "cccccccc-0000-0000-0000-0000000000ff", "txn-UNK"),
    /unknown_scope_id/
  );
});

test("invalid scope raises invalid_scope", async () => {
  const db = await freshDb();
  await assert.rejects(
    db.query("select spend_coins($1, $2, $3, $4)", [
      FIX.userHigh,
      "not_a_scope",
      FIX.premiumEnding,
      "txn-BADSCOPE",
    ]),
    /invalid_scope/
  );
});

test("a user with no wallet raises no_wallet before any write", async () => {
  const db = await freshDb();
  // gen_random_uuid not in users/coin_wallet: the FOR UPDATE finds no row and raises before the insert.
  await assert.rejects(
    spend(db, "aaaaaaaa-0000-0000-0000-0000000000ee", "beat_variant", FIX.premiumEnding, "txn-NOWALLET"),
    /no_wallet/
  );
});
