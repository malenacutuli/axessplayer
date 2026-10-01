// Served entry point for the engagement events collector. BOOT ORDER is the fix for the Render 502: the
// listener binds FIRST (so the port opens and Render's health check on GET /healthz passes immediately),
// and the node-postgres pool is created LAZILY on the first write that needs it, never at module load.
//
// Previously this module threw at the top level when DATABASE_URL was absent and built the pool eagerly,
// so any pg/env hiccup crashed the process before the port ever opened and Render reported 502. Now:
//   - nothing throws at module top-level for a recoverable condition;
//   - the pool is built once, lazily, behind a provider closure;
//   - a missing DATABASE_URL is surfaced as a clean startup error AFTER the listener is bound (so the
//     port is open and /healthz is green) and as a 503 on the write path, never a hard crash.
//
// Env: DATABASE_URL (required for writes), DB_OPTIONS (-c search_path=mobile,public for the hosted mobile
// schema), PORT (default 8098), HOST (default 0.0.0.0 for container reachability). No em dashes.

import pg from "pg";
import { createEventsServer, type SqlProvider } from "./server.js";
import { selectSessionVerifier } from "@axessplayer/session-auth";
import type { SqlClient } from "./collector.js";

// Lazily build (once) the pg pool and return it as the SqlClient. Throws ONLY when resolved, never at
// module load: a missing DATABASE_URL or an unreachable database becomes a recoverable 503 on the write
// path rather than a boot crash. The pool is memoized so repeated writes reuse one connection pool.
function makeLazyPool(): SqlProvider {
  let pool: pg.Pool | undefined;
  return () => {
    if (pool == null) {
      const databaseUrl = process.env.DATABASE_URL;
      if (databaseUrl == null || databaseUrl.length === 0) {
        throw new Error("events collector: DATABASE_URL is required");
      }
      pool = new pg.Pool({
        connectionString: databaseUrl,
        ...(process.env.DB_OPTIONS ? { options: process.env.DB_OPTIONS } : {}),
      });
    }
    return pool as unknown as SqlClient;
  };
}

const port = Number(process.env.PORT ?? 8098);
// Bind 0.0.0.0 by default so a container port map reaches the listener; 127.0.0.1 only answers loopback
// inside the container, which is what made Render report the service unhealthy.
const host = process.env.HOST ?? "0.0.0.0";

const provide = makeLazyPool();
// Viewer attribution from the verified Supabase session (auth_id -> mobile.users.id). Missing Supabase config
// means events are recorded anonymously, never attributed from an unsigned token.
const session = selectSessionVerifier(
  { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, NODE_ENV: process.env.NODE_ENV },
  () => ({ verifySession: async (t) => { const m = /^session:([0-9a-f-]{36})$/i.exec(t ?? ""); return m ? { userId: m[1] } : null; } }),
  "events collector",
  async (authId) => {
    const { rows } = await (provide() as unknown as { query: (s: string, p: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }).query(
      "select id from mobile.users where auth_id = $1 limit 1",
      [authId],
    );
    return rows[0]?.id ?? null;
  },
);
const server = createEventsServer(provide, { session });
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`events collector listening on ${host}:${port}`);
  // Surface a missing DATABASE_URL as a clean startup WARNING after the port is open (writes will 503
  // until it is set), instead of throwing at module load and crashing before the listener binds.
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.warn(
      "events collector: DATABASE_URL is not set; /healthz is up but POST /events will return 503 until it is configured",
    );
  }
});
