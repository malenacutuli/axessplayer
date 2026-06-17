// Served entry point for the engagement events collector. Builds the node-postgres pool from the env
// (DATABASE_URL, and DB_OPTIONS=-c search_path=mobile,public for the hosted mobile schema), wires the
// collector handler, and listens. No em dashes.

import pg from "pg";
import { createEventsServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl == null || databaseUrl.length === 0) {
  throw new Error("events collector: DATABASE_URL is required");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(process.env.DB_OPTIONS ? { options: process.env.DB_OPTIONS } : {}),
});

const port = Number(process.env.PORT ?? 8098);
const host = process.env.HOST ?? "127.0.0.1";
createEventsServer(pool).listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`events collector listening on ${host}:${port}`);
});
