// Integration harness for the coin ledger. Stands up an in-process Postgres (PGlite, real
// Postgres compiled to wasm, with plpgsql) and applies the same files supabase db reset applies:
// every supabase/migrations/*.sql in lexical order, then supabase/seed.sql. No live service needed.
// No em dashes.

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// test -> economy -> services -> repo root
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

// Fixture ids from supabase/seed.sql, named so the assertions read like the contract.
export const FIX = {
  series: "11111111-1111-1111-1111-111111111111",
  episode: "22222222-2222-2222-2222-222222222222",
  userHigh: "aaaaaaaa-0000-0000-0000-000000000001", // wallet 10, intensity 5
  userLow: "aaaaaaaa-0000-0000-0000-000000000002",  // wallet 10, intensity 2
  premiumEnding: "cccccccc-0000-0000-0000-000000000005", // is_premium, coin_cost 5
  freeEnding: "cccccccc-0000-0000-0000-000000000004",    // coin_cost 0
} as const;

// Spin up a fresh database with migrations + seed applied. Each call is fully isolated.
export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);
  for (const f of files) {
    await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
  }
  await db.exec(await readFile(seedFile, "utf8"));
  return db;
}

// Convenience reads against the seeded fixtures.
export async function walletTotal(db: PGlite, userId: string): Promise<number> {
  const r = await db.query<{ total: number }>(
    "select (balance + bonus_balance)::int as total from coin_wallet where user_id = $1",
    [userId]
  );
  return r.rows[0]?.total ?? -1;
}

export async function walletParts(db: PGlite, userId: string): Promise<{ balance: number; bonus: number }> {
  const r = await db.query<{ balance: number; bonus: number }>(
    "select balance::int as balance, bonus_balance::int as bonus from coin_wallet where user_id = $1",
    [userId]
  );
  return { balance: r.rows[0].balance, bonus: r.rows[0].bonus };
}

export async function countRows(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(sql, params as never[]);
  return Number(r.rows[0].n);
}

// Call the RPC under test. Returns the new total balance it reports.
export async function spend(
  db: PGlite,
  userId: string,
  scope: "episode" | "beat_variant",
  scopeId: string,
  txn: string
): Promise<number> {
  const r = await db.query<{ spend_coins: number }>(
    "select spend_coins($1, $2, $3, $4) as spend_coins",
    [userId, scope, scopeId, txn]
  );
  return r.rows[0].spend_coins;
}
