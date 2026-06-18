// Production HTTP entry point for the ONLINE experiment serving tier (Slice B). Binds the framework-free
// router (http/app.ts) to a real node:http server. It binds 0.0.0.0 so a container port map reaches it: a
// process bound to 127.0.0.1 only answers on the loopback inside the container. node:http is used (not an
// external server package) so the bridge needs no new dependency. MIRRORS services/content/src/server.ts.
//
// NOT DEPLOYED THIS WAVE: this service is intentionally absent from render.yaml. The listener and pg
// wiring exist and are testable, but no deploy target references them.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool (future pg-backed store).
//   DB_OPTIONS     public. Passed verbatim as the connection `options`. On the shared hosted project set
//                  DB_OPTIONS=-c search_path=mobile,public so unqualified names resolve to the `mobile`
//                  schema. Unset for local dev.
//   PORT           public. TCP port the listener binds. Defaults to 8098 (Slice B port).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";

import { DEFAULT_PORT } from "./config.js";
import { route, readJsonBody, parseUrl, type AppDeps } from "./http/app.js";
import { InMemoryExperimentStore } from "./store.js";
import { UnwiredPosterCandidateStore } from "./poster-candidates.js";
import { testSessionVerifier } from "./http/auth.js";

export interface ExperimentServerConfig {
  databaseUrl: string | undefined;
  dbOptions: string | undefined;
}

// Read config from the environment. DATABASE_URL is OPTIONAL here: the shipped store is the in-memory
// fake, so the listener serves with no database. A pg Pool is constructed only when DATABASE_URL is set,
// ready for the pg-backed store cutover without changing this entry.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ExperimentServerConfig {
  return { databaseUrl: env.DATABASE_URL, dbOptions: env.DB_OPTIONS };
}

// Build the app deps. Production injects a real session verifier; this default wires the TEST verifier
// and the in-memory store. The pool is accepted so a pg-backed store can replace the in-memory one
// without touching the bridge.
export function buildDeps(_pool?: pg.Pool): AppDeps {
  // The poster candidate store is the UNWIRED store until 09_poster_candidates.sql is applied: the candidate
  // read returns an empty set (source "unwired") and /poster/select falls back to the single series poster.
  // A pg-backed store reading mobile.poster_candidates replaces this once the table is applied, without
  // touching the router or the bandit core.
  return {
    store: new InMemoryExperimentStore(),
    session: testSessionVerifier(),
    posterCandidates: new UnwiredPosterCandidateStore(),
  };
}

// Permissive CORS so the Vercel preview browsers can call this tier cross-origin with a bearer token.
// Mirrors the identity/content services: ACAO:* on every response, preflight answered 204. No cookies.
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

async function writeResult(res: ServerResponse, status: number, body: unknown): Promise<void> {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...CORS_HEADERS,
  });
  res.end(payload);
}

// Bind the router to a real node:http server. host defaults to 0.0.0.0 for container reachability; port 0
// picks an ephemeral port (tests). Resolves with the server and bound port.
export function startServer(
  deps: AppDeps,
  port = 0,
  host = "0.0.0.0"
): Promise<{ server: Server; port: number }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        // CORS preflight: answer 204 with the ACAO headers before any routing/auth.
        if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        const { pathname, query } = parseUrl(req);
        const body = await readJsonBody(req);
        const result = await route(
          req.method ?? "GET",
          pathname,
          query,
          body,
          req.headers.authorization,
          deps
        );
        await writeResult(res, result.status, result.body);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...CORS_HEADERS,
          });
        }
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

// Start the listener from the process environment. Called unconditionally by the guard-free entry
// src/online/serve.ts. Sets process.exitCode on failure rather than letting the rejection escape.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool =
      cfg.databaseUrl != null && cfg.databaseUrl.length > 0
        ? new pg.Pool({
            connectionString: cfg.databaseUrl,
            ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
          })
        : undefined;
    const deps = buildDeps(pool);
    const { port: bound } = await startServer(deps, port, host);
    // eslint-disable-next-line no-console
    console.log(`experiment online service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start experiment online server", err);
    process.exitCode = 1;
  }
}
