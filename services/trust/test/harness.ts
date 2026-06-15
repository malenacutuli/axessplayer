// Integration harness for the trust service. Stands up an in-process Postgres (PGlite, real Postgres
// compiled to wasm with plpgsql) and applies the same files supabase db reset applies: every
// supabase/migrations/*.sql in lexical order, then supabase/seed.sql. Tests run against the REAL frozen
// migrations, so the NOT NULL provenance / consent FK constraints are the genuine ones. No em dashes.

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { QueryClient } from "../src/pgTrustDb.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// test -> trust -> services -> repo root
const repoRoot = path.resolve(here, "..", "..", "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

// Variant fixtures from supabase/seed.sql.
export const FIX = {
  coldOpen: "cccccccc-0000-0000-0000-000000000001", // A_filmed variant, exists
  premiumEnding: "cccccccc-0000-0000-0000-000000000005", // is_premium variant, exists
  // A well-formed UUID that is not in beat_variants. Inserts referencing it must fail the FK.
  unknownVariant: "deadbeef-0000-0000-0000-000000000000",
} as const;

// PGlite's query() takes (sql, params) and returns { rows }. That matches the QueryClient port.
export type TestDb = PGlite & QueryClient;

export async function freshDb(): Promise<TestDb> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);
  for (const f of files) {
    await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
  }
  await db.exec(await readFile(seedFile, "utf8"));
  return db as TestDb;
}
