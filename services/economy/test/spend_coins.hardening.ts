// Regression suite for the 0003 hardening migration, against a real multi-connection Postgres.
// Guards the four fixed findings so they cannot silently regress: F1 (execute privileges), F2 (pg_temp
// shadowing), F3 (deterministic idempotency under a race), F5 (negative price). Also re-checks the core
// behavioral invariants on the hardened function. Roles must exist before 0003 runs, so this boots its
// own server rather than reusing pgharness. Run via `pnpm test:hardening`. No em dashes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

const U = "aaaaaaaa-0000-0000-0000-000000000001";
const PREMIUM = "cccccccc-0000-0000-0000-000000000005";

let epg: EmbeddedPostgres | null = null;
let pool: pg.Pool;

before(async () => {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
  } else {
    const port = 5400 + Math.floor(Math.random() * 150);
    epg = new EmbeddedPostgres({
      databaseDir: `/tmp/epg_harden_${port}_${Date.now()}`,
      user: "postgres",
      password: "pw",
      port,
      persistent: false,
    });
    await epg.initialise();
    await epg.start();
    pool = new pg.Pool({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres", max: 16 });
  }
  // Roles must exist before 0003 so its REVOKE/GRANT block acts on them.
  for (const r of ["anon", "authenticated", "service_role"]) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$;`);
  }
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await pool.query(await readFile(path.join(migrationsDir, f), "utf8"));
  await pool.query(await readFile(seedFile, "utf8"));
});

after(async () => {
  await pool.end();
  if (epg) await epg.stop();
});

async function resetWallet(balance: number, bonus = 0): Promise<void> {
  await pool.query("delete from entitlements where user_id = $1", [U]);
  await pool.query("delete from coin_transactions where user_id = $1", [U]);
  await pool.query("update public.coin_wallet set balance = $2, bonus_balance = $3 where user_id = $1", [U, balance, bonus]);
}
async function spend(scope: string, scopeId: string, txn: string): Promise<number> {
  const r = await pool.query("select spend_coins($1,$2,$3,$4) as r", [U, scope, scopeId, txn]);
  return Number(r.rows[0].r);
}
async function total(): Promise<number> {
  const r = await pool.query("select (balance + bonus_balance)::int as n from public.coin_wallet where user_id = $1", [U]);
  return Number(r.rows[0].n);
}
async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params as never[]);
  return Number(r.rows[0].n);
}

test("F1: only the trusted role may execute spend_coins", async () => {
  const can = async (role: string) =>
    (await pool.query("select has_function_privilege($1,'public.spend_coins(uuid,text,uuid,text)','EXECUTE') as e", [role])).rows[0].e;
  assert.equal(await can("authenticated"), false, "authenticated cannot execute");
  assert.equal(await can("anon"), false, "anon cannot execute");
  assert.equal(await can("service_role"), true, "service_role can execute");
});

test("F2: the hardened function ignores a pg_temp coin_wallet shadow", async () => {
  await resetWallet(10);
  const c = await pool.connect();
  try {
    await c.query("create temp table coin_wallet (user_id uuid primary key, balance int, bonus_balance int, updated_at timestamptz)");
    await c.query("insert into coin_wallet values ($1, 999999, 999999, now())", [U]);
    const returned = Number((await c.query("select spend_coins($1,$2,$3,$4) as r", [U, "beat_variant", PREMIUM, "shadow"])).rows[0].r);
    assert.equal(returned, 5, "read the real public wallet (10 -> 5), not the 999999 shadow");
    await c.query("drop table coin_wallet");
    const real = Number((await c.query("select (balance+bonus_balance)::int n from public.coin_wallet where user_id=$1", [U])).rows[0].n);
    assert.equal(real, 5, "the real wallet was charged, the shadow was inert");
  } finally {
    c.release();
  }
});

test("F5: the catalog CHECK blocks a negative price at the source", async () => {
  await assert.rejects(
    pool.query("update beat_variants set coin_cost = -5 where id = $1", [PREMIUM]),
    /coin_cost_nonneg|check constraint/i
  );
});

test("F3: 40-way same-txn race is a deterministic no-op, exactly one charge", async () => {
  await resetWallet(100);
  const results = await Promise.allSettled([...Array(40)].map(() => spend("beat_variant", PREMIUM, "race")));
  const unique = results.filter((r): r is PromiseRejectedResult => r.status === "rejected" && /duplicate key|unique/i.test(String(r.reason?.message))).length;
  assert.equal(await scalar("select count(*) n from coin_transactions where user_id=$1 and client_txn_id='race'", [U]), 1, "exactly one charge");
  assert.equal(await total(), 95, "charged once 100 -> 95");
  assert.equal(unique, 0, "no unique_violation surfaced to callers");
});

test("F3: replay of an applied txn at zero balance returns the total, not insufficient_funds", async () => {
  await resetWallet(100);
  await spend("beat_variant", PREMIUM, "keep"); // 100 -> 95
  for (let i = 0; i < 19; i++) await spend("beat_variant", PREMIUM, "drain" + i); // to 0
  const replay = await spend("beat_variant", PREMIUM, "keep");
  assert.equal(replay, 0, "idempotent replay returns current total (0), not an insufficient_funds error");
});

test("behavior preserved: deduct once, idempotent replay, insufficient_funds, bonus-first", async () => {
  await resetWallet(10);
  assert.equal(await spend("beat_variant", PREMIUM, "p1"), 5);
  assert.equal(await total(), 5);
  assert.equal(await spend("beat_variant", PREMIUM, "p1"), 5, "replay no-op");
  assert.equal(await total(), 5);
  await resetWallet(10, 3);
  assert.equal(await spend("beat_variant", PREMIUM, "b1"), 8, "13 - 5 = 8");
  assert.equal(await scalar("select bonus_balance n from public.coin_wallet where user_id=$1", [U]), 0, "bonus first");
  await resetWallet(3);
  await assert.rejects(spend("beat_variant", PREMIUM, "x1"), /insufficient_funds/);
});
