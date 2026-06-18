// HTTP surface for the engagement events collector. POST /events { events: [...] } persists the batch
// to mobile.engagement_events. Identity is taken from the Authorization session bearer (F1), never the
// body. Permissive CORS so the browser analytics-sdk can post cross-origin in dev. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { persistEvents, userFromAuthorization, type RawEvent, type SqlClient } from "./collector.js";
import { persistAxpEvent, isAxpEventBody } from "./axp-collector.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
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

export function createEventsServer(sql: SqlClient): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? "GET").toUpperCase();
        if (method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        if (req.url === "/healthz") return send(res, 200, { ok: true });
        if (method === "POST" && (req.url ?? "").startsWith("/events")) {
          const raw = await readBody(req);
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            return send(res, 400, { error: "invalid json" });
          }
          const userId = userFromAuthorization(req.headers["authorization"]);
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
