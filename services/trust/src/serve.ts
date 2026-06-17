// Served entry point for the trust service. Builds the Postgres-backed TrustDB (hosted mobile schema via
// DATABASE_URL + DB_OPTIONS=-c search_path=mobile,public) and serves the trust HTTP surface. No em dashes.

import pg from "pg";
import { TrustService } from "./trust.js";
import { PgTrustDb } from "./pgTrustDb.js";
import { createTrustServer } from "./server.js";
import { SOVEREIGN_DEFAULT } from "./sovereignty.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl == null || databaseUrl.length === 0) {
  throw new Error("trust service: DATABASE_URL is required");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(process.env.DB_OPTIONS ? { options: process.env.DB_OPTIONS } : {}),
});

const trust = new TrustService(new PgTrustDb(pool));
const port = Number(process.env.PORT ?? 8099);
const host = process.env.HOST ?? "127.0.0.1";
createTrustServer(trust).listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`trust service listening on ${host}:${port} (sovereign default ${SOVEREIGN_DEFAULT})`);
});
