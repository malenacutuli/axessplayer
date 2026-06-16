// Production HTTP entry point for the decision service. The package EXPORTS createDecisionApp (a Hono app
// factory) but nothing listens on it, and unlike economy/content it ships no production DecideDeps: only
// in-memory FAKES for the KV/logger/cohort ports (kv.ts, logger.ts, features.ts) and an engine that takes
// the ports by injection. This entrypoint wires the production deps it can build, wraps the factory in a
// real node:http server, and binds 0.0.0.0 so a container port map reaches it (a process bound to
// 127.0.0.1 only answers on the loopback inside the container). The engine (decide.ts) is consumed
// UNCHANGED; this file only ADDS wiring around it. No em dashes.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool the engine's DecisionDB
//                  port reads (beats, beat_edges, beat_variants, users, viewer_state) and the logger writes
//                  the decision_log row through.
//   PORT           public. TCP port the listener binds. Defaults to 8080 (matches the Dockerfile).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images. Outside production the TEST session verifier is
//                  used for local/dev wiring; in production a real verifier is required (CUTOVER GATE).
//   AUTH_JWKS_URL/AUTH_JWT_ISSUER/AUTH_JWT_AUDIENCE  real JWKS verifier config. See CUTOVER GATE.
//
// CUTOVER GATE (flagged, not faked):
//   1. AUTH / JWKS: real session token verification is NOT implemented (auth.ts ships a TEST verifier
//      only). In production a real Verifiers MUST be injected here. Starting with NODE_ENV=production
//      throws rather than silently serving with the test verifier.
//   2. KV serving cache: the real Redis/edge KV and its CDC refresh are NOT built in this cut (kv.ts).
//      This entrypoint wires the InMemoryKV fake; arm models and viewer vectors are NOT shared across
//      processes or warmed from Postgres. Reachable but not production-correct serving state.
//   3. decision_log stream: the real append-only stream + batch loader are NOT built in this cut
//      (logger.ts). This entrypoint wires a SYNCHRONOUS Postgres insert (PgDecisionLogger) so a decision
//      is durably logged; the design calls for a non-blocking stream, so this is a stopgap, flagged.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createDecisionApp } from "./http/app.js";
import { testVerifiers, type Verifiers } from "./http/auth.js";
import type { DecisionDB, DecideDeps } from "./decide.js";
import type { CanonCandidate, CanonFacts } from "./canon.js";
import type { Branch } from "./policy.js";
import { type DecisionLogger, type DecisionLogRow } from "./logger.js";
import { InMemoryKV } from "./kv.js";
import { InMemoryCohortSeeds } from "./features.js";

export interface DecisionServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  // Optional Postgres startup options, passed verbatim as the connection `options` parameter. On the shared
  // hosted project set DB_OPTIONS=-c search_path=mobile,public so unqualified names resolve to `mobile`.
  // Unset for local dev (default `public`).
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: the engine reads the content graph
// and per-viewer system of record from Postgres, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DecisionServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("decision server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return { databaseUrl, nodeEnv: env.NODE_ENV, ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}) };
}

// Choose the verifiers. In production a real JWKS-backed Verifiers MUST be injected; the test verifier is
// refused there (CUTOVER GATE 1). Outside production the test verifier is wired for local/dev use.
export function selectVerifiers(cfg: DecisionServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "decision server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production"
    );
  }
  return testVerifiers();
}

// The engine's DecisionDB port over real Postgres. Reads the content graph and per-viewer state. Read-only;
// it never alters the schema. Mirrors the harness wiring in tests/e2e/src/decisionWiring.ts so the served
// process reads the same database as the acceptance flow.
export class PgDecisionDb implements DecisionDB {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async seriesOfBeat(beatId: string): Promise<string> {
    const r = await this.db.query("select series_id from public.beats where id = $1", [beatId]);
    if (r.rows.length === 0) throw new Error("unknown_beat");
    return r.rows[0].series_id as string;
  }

  async candidatesOf(beatId: string): Promise<CanonCandidate[]> {
    const r = await this.db.query(
      `select e.to_beat_id, e.condition, v.id as variant_id
         from public.beat_edges e
         join public.beat_variants v on v.beat_id = e.to_beat_id
        where e.from_beat_id = $1
        order by v.id`,
      [beatId]
    );
    return r.rows.map((row) => {
      const condition = (row.condition ?? {}) as Record<string, unknown>;
      const branch = (condition.branch === "tense" ? "tense" : "calm") as Branch;
      return { variantId: row.variant_id as string, branch, validEdge: true };
    });
  }

  async canonFactsOf(beatId: string): Promise<CanonFacts> {
    const r = await this.db.query("select canon_facts from public.beats where id = $1", [beatId]);
    return (r.rows[0]?.canon_facts ?? {}) as CanonFacts;
  }

  async cohortOf(userId: string, seriesId: string): Promise<string | null> {
    const r = await this.db.query(
      "select cohort_id from public.viewer_state where user_id = $1 and series_id = $2",
      [userId, seriesId]
    );
    return (r.rows[0]?.cohort_id as string | null) ?? null;
  }

  async adaptiveOptIn(userId: string): Promise<boolean> {
    const r = await this.db.query("select adaptive_opt_in from public.users where id = $1", [userId]);
    return r.rows[0]?.adaptive_opt_in !== false;
  }
}

// Writes a decision_log row and returns its id. CUTOVER GATE 3: the design wants a non-blocking stream;
// this synchronous insert is the stopgap until the real stream + batch loader land. Flagged in logger.ts.
export class PgDecisionLogger implements DecisionLogger {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async log(row: Omit<DecisionLogRow, "id">): Promise<string> {
    const r = await this.db.query(
      `insert into public.decision_log
         (user_id, beat_id, served_variant_id, is_control, policy_version, propensity)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [row.user_id, row.beat_id, row.served_variant_id, row.is_control, row.policy_version, row.propensity]
    );
    return r.rows[0].id as string;
  }
}

// Assemble the production DecideDeps: the Postgres DB and logger above, plus the shipped in-memory KV and
// cohort fakes (CUTOVER GATE 2: real KV/CDC is out of this cut). The engine takes these by injection.
export function buildDecisionDeps(pool: pg.Pool): DecideDeps {
  return {
    db: new PgDecisionDb(pool),
    kv: new InMemoryKV(),
    logger: new PgDecisionLogger(pool),
    cohorts: new InMemoryCohortSeeds(),
  };
}

// Build the production decision app: the engine deps above plus the chosen verifiers, handed to the
// existing factory unchanged.
export function buildDecisionApp(pool: pg.Pool, cfg: DecisionServerConfig): Hono {
  return createDecisionApp({ decisionDeps: buildDecisionDeps(pool), verifiers: selectVerifiers(cfg) });
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/manifest/src/server.ts and tests/e2e/src/servers.ts. Forwards the body so POST /decide
// works over the wire.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "decision.local";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.length > 0) {
    init.body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as BodyInit;
  }
  return new Request(url, init);
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Bind a Hono app to a real node:http server. host defaults to 0.0.0.0 for container reachability; port 0
// picks an ephemeral port (tests). Resolves with the server and bound port.
export function startServer(
  app: Hono,
  port = 0,
  host = "0.0.0.0"
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const webRes = await app.fetch(toWebRequest(req, body));
        await writeWebResponse(res, webRes);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
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

// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry file
// src/serve.ts (the package `serve` script points node at that file). The previous is-main guard evaluated
// FALSE under `node --import tsx src/server.ts` run via pnpm, so the listener never started in the
// container. Extracting the start logic here and invoking it from a tiny no-guard entry makes startup
// deterministic. selectVerifiers still throws under NODE_ENV=production, so the CUTOVER GATE hard stop is
// preserved. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8080);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildDecisionApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`decision service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start decision server", err);
    process.exitCode = 1;
  }
}
