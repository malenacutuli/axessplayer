// HTTP surface for the engagement events collector. POST /events { events: [...] } persists the batch
// to mobile.engagement_events. Identity is taken from the Authorization session bearer (F1), never the
// body. Permissive CORS so the browser analytics-sdk can post cross-origin in dev. No em dashes.
//
// BOOT RESILIENCE: the SQL client is obtained LAZILY (a provider closure) per request, never at server
// construction. createEventsServer therefore never connects to pg, so the listener can bind and answer
// GET /healthz with 200 even when the database is briefly unreachable or DATABASE_URL surfaces late. A
// failure to obtain the client (or a query error) degrades to a clean 503 on the write path instead of
// crashing the process. This is why Render sees the port open and the service healthy at boot.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { persistEvents, userFromAuthorization, type RawEvent, type SqlClient } from "./collector.js";
import { testSessionsAllowed, type SessionVerifier } from "@axessplayer/session-auth";
import { persistAxpEvent, isAxpEventBody } from "./axp-collector.js";

// A lazy provider of the SQL client. Resolving it may build/borrow a pg pool on first use, or throw if the
// database is unreachable. The server treats a throw as a recoverable 503, never a process crash.
export type SqlProvider = () => Promise<SqlClient> | SqlClient;

// Accept either a concrete client (eager wiring, e.g. tests) or a lazy provider (production boot).
function asProvider(sqlOrProvider: SqlClient | SqlProvider): SqlProvider {
  return typeof sqlOrProvider === "function"
    ? (sqlOrProvider as SqlProvider)
    : () => sqlOrProvider;
}

// Permissive CORS so the Vercel preview browsers / analytics-sdk can post cross-origin with a bearer
// token. Mirrors the identity/content services: ACAO:* on every response, preflight answered 204.
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export interface EventsServerOptions {
  // Resolves the bearer to the viewer (users.id). Production wires the Supabase verifier; without it only the
  // explicit test opt-in path (session:<uuid>) attributes events, otherwise events are anonymous.
  session?: SessionVerifier;
}

export function createEventsServer(sqlOrProvider: SqlClient | SqlProvider, opts: EventsServerOptions = {}): Server {
  const provideSql = asProvider(sqlOrProvider);
  const identify = async (authorization: string | undefined): Promise<string | null> => {
    const m = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
    if (!m) return null;
    if (opts.session) return (await opts.session.verifySession(m[1]))?.userId ?? null;
    return testSessionsAllowed() ? userFromAuthorization(authorization) : null;
  };
  return createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? "GET").toUpperCase();
        if (method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        // Liveness MUST NOT touch the database: Render's health check has to pass at boot even before pg
        // is reachable. Strip any query string so /healthz?x=1 still matches.
        if ((req.url ?? "").split("?")[0] === "/healthz") return send(res, 200, { ok: true });
        if (method === "POST" && (req.url ?? "").startsWith("/events")) {
          const raw = await readBody(req);
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            return send(res, 400, { error: "invalid json" });
          }
          // Obtain the SQL client lazily. A connection failure here is recoverable: degrade to 503 so the
          // collector buffers/retries client-side rather than crashing the process.
          let sql: SqlClient;
          try {
            sql = await provideSql();
          } catch (e) {
            return send(res, 503, {
              error: "database unavailable",
              detail: e instanceof Error ? e.message : String(e),
            });
          }
          // Attribution is the VERIFIED session subject; an unverifiable token is recorded as anonymous.
          const userId = await identify(req.headers["authorization"]);
          // Canonical AxpEvent single-event ingest (analytics-sdk emit client wire shape). Validated
          // against the closed taxonomy, idempotent on (session_id, event_id).
          if (isAxpEventBody(parsed)) {
            const r = await persistAxpEvent(sql, userId, parsed);
            if (!r.ok) return send(res, 400, { error: r.reason });
            return send(res, 202, { accepted: 1, deduped: r.deduped });
          }
          // Legacy events.md batch path: { events: [...] }.
          const batch = (parsed ?? {}) as { events?: RawEvent[] };
          const events = Array.isArray(batch.events) ? batch.events : [];
          const result = await persistEvents(sql, userId, events);
          return send(res, 200, result);
        }
        send(res, 404, { error: "not found" });
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}
