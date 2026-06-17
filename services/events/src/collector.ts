// Engagement events collector core. Pure validation + mapping + persistence of the frozen
// contracts/events/events.md events into mobile.engagement_events. Identity (user_id) is stamped by the
// caller from the session subject and is NEVER read from the event body (F1). Append-only and idempotent
// on (session_id, event_id). No em dashes.

// Minimal query interface (matches pg.Pool.query) so this has no hard pg dependency and is testable.
export interface SqlClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

// The frozen beat/session event types (events.md v0.3.0). Ledger and decision events are emitted by the
// economy and decision services directly, not by this client-facing collector.
export const EVENT_TYPES = [
  "beat_started",
  "beat_progress",
  "beat_completed",
  "beat_skipped",
  "choice_made",
  "session_ended",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type RawEvent = {
  event_id?: unknown;
  ts?: unknown;
  series_id?: unknown;
  session_id?: unknown;
  type?: unknown;
  decision_id?: unknown;
  beat_id?: unknown;
  variant_id?: unknown;
  completion?: unknown;
  [k: string]: unknown;
};

export type Validation = { ok: true } | { ok: false; reason: string };

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

export function validateEvent(e: RawEvent): Validation {
  if (e === null || typeof e !== "object") return { ok: false, reason: "not an object" };
  if (!isNonEmptyString(e.event_id)) return { ok: false, reason: "event_id required" };
  if (!isNonEmptyString(e.session_id)) return { ok: false, reason: "session_id required" };
  if (!EVENT_TYPES.includes(e.type as EventType)) return { ok: false, reason: `unknown type ${String(e.type)}` };
  // F1: identity is the session subject. A user_id in the wire body is a contract violation, not data.
  if ("user_id" in e) return { ok: false, reason: "user_id must not be in the event body (F1)" };
  if (e.completion !== undefined && typeof e.completion !== "number") return { ok: false, reason: "completion must be a number" };
  return { ok: true };
}

export const INSERT_EVENT_SQL =
  `insert into mobile.engagement_events
     (event_id, user_id, series_id, session_id, type, decision_id, beat_id, variant_id, completion, payload, ts)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()))
   on conflict (session_id, event_id) do nothing`;

// Map a validated event to insert params. user_id is supplied by the caller (session subject), never the
// body. The whole event is kept in payload so no field is lost even if it is not promoted to a column.
export function eventToParams(userId: string | null, e: RawEvent): unknown[] {
  const str = (x: unknown) => (isNonEmptyString(x) ? x : null);
  return [
    e.event_id,
    userId,
    str(e.series_id),
    e.session_id,
    e.type,
    str(e.decision_id),
    str(e.beat_id),
    str(e.variant_id),
    typeof e.completion === "number" ? e.completion : null,
    JSON.stringify(e),
    str(e.ts),
  ];
}

export type PersistResult = { accepted: number; rejected: { event_id?: string; reason: string }[] };

// Persist a batch. Invalid events are rejected with a reason and never block the valid ones (a poison
// event must not drop a whole batch). Idempotent: a re-sent (session_id, event_id) is a no-op insert.
export async function persistEvents(sql: SqlClient, userId: string | null, events: RawEvent[]): Promise<PersistResult> {
  const result: PersistResult = { accepted: 0, rejected: [] };
  for (const e of events) {
    const v = validateEvent(e);
    if (!v.ok) {
      result.rejected.push({ event_id: typeof e?.event_id === "string" ? e.event_id : undefined, reason: v.reason });
      continue;
    }
    await sql.query(INSERT_EVENT_SQL, eventToParams(userId, e));
    result.accepted++;
  }
  return result;
}

// Parse the acting user id from a session bearer of the form "session:<uuid>" (the dev/test verifier
// convention shared with the economy service). Returns null for anon/absent, so events still log.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function userFromAuthorization(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return null;
  const s = /^session:(.+)$/.exec(m[1]);
  if (!s || !UUID_RE.test(s[1])) return null;
  return s[1];
}
