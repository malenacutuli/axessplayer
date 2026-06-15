// Real-Postgres harness for the experiment suite. Mirrors services/economy/test/pgharness.ts: uses a
// CI-provided DATABASE_URL if present, otherwise a local embedded-postgres binary running as the current
// user. Applies migrations 0001..0005 + seed, the same chain as `supabase db reset`, so the off-policy
// reads run against a REAL decision_log, not a mock. No em dashes.

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

export interface PgHandle {
  pool: pg.Pool;
  stop: () => Promise<void>;
}

async function applySchema(pool: pg.Pool): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await pool.query(await readFile(path.join(migrationsDir, f), "utf8"));
  await pool.query(await readFile(seedFile, "utf8"));
}

export async function startPg(): Promise<PgHandle> {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    await applySchema(pool);
    return { pool, stop: async () => { await pool.end(); } };
  }
  const port = 5560 + Math.floor(Math.random() * 150);
  const epg = new EmbeddedPostgres({
    databaseDir: `/tmp/epg_exp_${port}_${Date.now()}`,
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
    max: 8,
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
