// Multi-connection Postgres harness for the concurrency suite. PGlite is single-connection and
// cannot exercise FOR UPDATE contention, so this uses a real server: a CI-provided DATABASE_URL if
// present (a `postgres:` service container), otherwise a local embedded-postgres binary that runs as
// the current user (no root). Applies migrations + seed, the same chain as `supabase db reset`.
// No em dashes.

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
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 24 });
    await applySchema(pool);
    return { pool, stop: async () => { await pool.end(); } };
  }
  const port = 5400 + Math.floor(Math.random() * 150);
  const epg = new EmbeddedPostgres({
    databaseDir: `/tmp/epg_${port}_${Date.now()}`,
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
    max: 24,
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
