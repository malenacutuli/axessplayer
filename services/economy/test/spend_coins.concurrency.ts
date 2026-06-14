// W2 definition-of-done concurrency suite for spend_coins, against a real multi-connection Postgres.
// It asserts the two safety invariants under contention: no double-spend on a duplicate client_txn_id,
// and no overspend below zero on distinct concurrent spends. It also OBSERVES (and logs, not asserts)
// how losing concurrent calls fail, because that behavior is input to the security review.
// Kept out of the default fast suite (filename is not *.test.ts); run via `pnpm test:concurrency`.
// No em dashes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startPg, type PgHandle } from "./pgharness.js";

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const PREMIUM = "cccccccc-0000-0000-0000-000000000005"; // is_premium, coin_cost 5

let H: PgHandle;

before(async () => {
  H = await startPg();
});
after(async () => {
  await H.stop();
});

async function resetWallet(balance: number, bonus = 0): Promise<void> {
  await H.pool.query("delete from entitlements where user_id = $1", [USER]);
  await H.pool.query("delete from coin_transactions where user_id = $1", [USER]);
  await H.pool.query("update coin_wallet set balance = $2, bonus_balance = $3 where user_id = $1", [
    USER,
    balance,
    bonus,
  ]);
}

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await H.pool.query(sql, params as never[]);
  return Number(r.rows[0].n);
}

test("no double-spend under N concurrent calls with the SAME client_txn_id", async () => {
  await resetWallet(100);
  const N = 40;
  const results = await Promise.allSettled(
    [...Array(N)].map(() =>
      H.pool.query("select spend_coins($1, $2, $3, $4)", [USER, "beat_variant", PREMIUM, "same-txn"])
    )
  );

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  const uniqueViolations = rejected.filter((r) => /duplicate key|unique/i.test(String(r.reason?.message))).length;

  const txns = await scalar(
    "select count(*)::int as n from coin_transactions where user_id = $1 and client_txn_id = 'same-txn'",
    [USER]
  );
  const bal = await scalar("select balance::int as n from coin_wallet where user_id = $1", [USER]);
  const ents = await scalar("select count(*)::int as n from entitlements where user_id = $1", [USER]);

  // SAFETY: charged exactly once, one ledger row, one entitlement, regardless of the N-way race.
  assert.equal(txns, 1, `exactly one ledger row despite ${N} concurrent duplicates`);
  assert.equal(bal, 95, "charged exactly once (100 -> 95)");
  assert.equal(ents, 1, "exactly one entitlement");

  // OBSERVATION for the security review: the idempotency is enforced by the UNIQUE(user_id, client_txn_id)
  // constraint, so the losers do not no-op gracefully under true concurrency, they raise unique_violation.
  // The sequential replay path (the fast suite) IS a clean no-op; the concurrent duplicate is an error the
  // caller must treat as "already applied".
  console.log(
    `  [obs] same-txn race: ${fulfilled} fulfilled, ${rejected.length} rejected, ${uniqueViolations} unique_violation`
  );
});

test("no overspend below zero under N concurrent distinct spends", async () => {
  const CAP = 100;
  const COST = 5;
  const N = 50; // more spend attempts than the wallet can fund
  await resetWallet(CAP); // exactly CAP/COST = 20 can succeed

  // Own-once means we cannot drain by re-buying one scope, so spend across N DISTINCT priced scopes.
  const ENDING_BEAT = "bbbbbbbb-0000-0000-0000-000000000004";
  const scopeIds = [...Array(N)].map((_, i) => `dddddddd-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
  await H.pool.query(
    `insert into beat_variants (id, beat_id, language, intensity, tier, is_premium, coin_cost, playback_url)
     select u, $2, 'en', 3, 'A_filmed', true, $3, 'https://cdn.example/over/' || u
     from unnest($1::uuid[]) u
     on conflict (id) do nothing`,
    [scopeIds, ENDING_BEAT, COST]
  );

  const results = await Promise.allSettled(
    scopeIds.map((sid, i) =>
      H.pool.query("select spend_coins($1, $2, $3, $4)", [USER, "beat_variant", sid, "txn-" + i])
    )
  );
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const insufficient = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected" && /insufficient_funds/.test(String(r.reason?.message))
  ).length;

  const spends = await scalar(
    "select count(*)::int as n from coin_transactions where user_id = $1 and type = 'spend'",
    [USER]
  );
  const bal = await scalar("select balance::int as n from coin_wallet where user_id = $1", [USER]);

  // SAFETY: exactly CAP/COST spends succeed, the wallet lands on exactly 0, never negative, ledger matches.
  assert.equal(fulfilled, CAP / COST, `exactly ${CAP / COST} spends succeed`);
  assert.equal(spends, CAP / COST, `exactly ${CAP / COST} ledger rows`);
  assert.equal(bal, 0, "balance lands on exactly 0");
  assert.ok(bal >= 0, "balance never goes negative");
  console.log(`  [obs] overspend race: ${fulfilled} succeeded, ${insufficient} insufficient_funds`);
});
