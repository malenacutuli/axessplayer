// Real Postgres for the W12 acceptance gate. Mirrors services/economy/test/pgharness.ts: a CI-provided
// DATABASE_URL (a postgres:15 service container) when present, otherwise a local embedded-postgres binary
// that runs as the current user (no root). Applies migrations 0001..0005 + supabase/seed.sql to a fresh
// database, the same chain as `supabase db reset`. The four services' production DB adapters (pgEconomyDb,
// pgContentDb, and the manifest/decision DB ports written here as wiring) talk to this over node-postgres.
// No em dashes.

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// src -> tests/e2e -> tests -> repo root
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

export interface PgHandle {
  pool: pg.Pool;
  stop: () => Promise<void>;
}

// Apply every migration in lexical order (0001..0005), then the walking-skeleton seed. The migrations
// CREATE TABLE without IF NOT EXISTS, so this must run against a fresh database.
async function applySchema(pool: pg.Pool): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await pool.query(await readFile(path.join(migrationsDir, f), "utf8"));
  await pool.query(await readFile(seedFile, "utf8"));
}

export async function startPg(): Promise<PgHandle> {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    await applySchema(pool);
    return { pool, stop: async () => { await pool.end(); } };
  }
  const port = 5550 + Math.floor(Math.random() * 200);
  const epg = new EmbeddedPostgres({
    databaseDir: `/tmp/epg_e2e_${port}_${Date.now()}`,
    user: "postgres",
    password: "pw",
    port,
    persistent: false,
  });
  await epg.initialise();
  await epg.start();
  const pool = new pg.Pool({
    host: "localhost",
    port,
    user: "postgres",
    password: "pw",
    database: "postgres",
    max: 12,
  });
  await applySchema(pool);
  return {
    pool,
    stop: async () => {
      await pool.end();
      await epg.stop();
    },
  };
}
