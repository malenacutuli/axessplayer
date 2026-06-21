// Canonical AxpEvent ingest core. This is the collector side of the GOLD_STANDARD_13 taxonomy in
// packages/analytics-sdk/src/events.ts. It is ADDITIVE to collector.ts (the frozen events.md batch
// path): it accepts a single AxpEvent in the analytics-sdk wire shape (camelCase: name, eventId,
// sessionId) and persists it to mobile.engagement_events.
//
// Contract guarantees:
//  - Validates name is a member of the closed AxpEventName set (the taxonomy). Unknown name rejected.
//  - Idempotent on (session_id, event_id) via the existing unique constraint and ON CONFLICT DO NOTHING.
//  - Identity is the session subject (F1): a userId hint on the event body is allowed but the persisted
//    user_id is the caller-supplied session subject, never the body field.
//
// No DDL is executed here. We write to the known columns of mobile.engagement_events and keep the whole
// event in payload so no field is lost even if it is not promoted to a column. No em dashes.

import type { SqlClient } from "./collector.js";

// Canonical AxpEventName set, mirrored from packages/analytics-sdk/src/events.ts (AXP_EVENT_NAMES).
// It is inlined here (not imported) so this collector stays a self-contained service with no extra
// workspace dependency to install. The analytics-sdk owns the source of truth and its exhaustiveness
// guard keeps the union and its list in lockstep; if a name is added there, add it here too. The order
// mirrors GOLD_STANDARD_13 section 2 for auditability. No em dashes.
export const AXP_EVENT_NAMES = [
  "impression",
  "play",
  "view_3s",
  "completion_50",
  "episode_completed",
  "beat_started",
  "beat_completed",
  "branch_shown",
  "branch_selected",
  "countdown_expired",
  "cut_switched",
  "pov_selected",
  "intensity_selected",
  "language_switched",
  "caption_toggled",
  "ad_toggled",
  "sign_toggled",
  "unlock_shown",
  "unlock_purchased",
  "premium_cut_shown",
  "premium_cut_purchased",
  "credits_earned",
  "credits_spent",
  "ad_watched",
  "checkin",
  "follow_bonus",
  "subscription_started",
  "subscription_canceled",
  "paywall_presented",
  "save",
  "unsave",
  "favorite",
  "character_followed",
  "channel_followed",
  "comment_posted",
  "comment_liked",
  "post_liked",
  "share",
  "invite_sent",
  "invite_joined",
  "invite_first_watch",
  "download_started",
  "download_completed",
  "offline_watched",
  "search_performed",
  "series_opened",
  "continue_resumed",
] as const;

// Local membership set derived from the mirrored taxonomy constant.
const AXP_NAME_SET = new Set<string>(AXP_EVENT_NAMES as readonly string[]);

export type RawAxpEvent = {
  eventId?: unknown;
  sessionId?: unknown;
  name?: unknown;
  userId?: unknown;
  seriesId?: unknown;
  episodeId?: unknown;
  beatId?: unknown;
  variantId?: unknown;
  // The decision this event is an outcome of, echoed from the /decide response. This is the join key the
  // Outcome Joiner (T3) needs to close the matched triple (decision -> outcome). Optional: events that are
  // not the consequence of a decision (e.g. a search) carry no decisionId.
  decisionId?: unknown;
  propensity?: unknown;
  ts?: unknown;
  props?: unknown;
  [k: string]: unknown;
};

export type AxpValidation = { ok: true } | { ok: false; reason: string };

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

export function validateAxpEvent(e: RawAxpEvent): AxpValidation {
  if (e === null || typeof e !== "object") return { ok: false, reason: "not an object" };
  if (!isNonEmptyString(e.eventId)) return { ok: false, reason: "eventId required" };
  if (!isNonEmptyString(e.sessionId)) return { ok: false, reason: "sessionId required" };
  if (!isNonEmptyString(e.name)) return { ok: false, reason: "name required" };
  if (!AXP_NAME_SET.has(e.name)) return { ok: false, reason: `name not in taxonomy: ${e.name}` };
  if (e.propensity !== undefined && typeof e.propensity !== "number") {
    return { ok: false, reason: "propensity must be a number" };
  }
  return { ok: true };
}

// Insert into the known columns of mobile.engagement_events. The taxonomy event name is written to the
// `type` column (the table's event-name column shared with the events.md path). Idempotent on the
// (session_id, event_id) unique key. completion is promoted from props.completion when numeric.
export const INSERT_AXP_EVENT_SQL =
  `insert into mobile.engagement_events
     (event_id, user_id, series_id, session_id, type, decision_id, beat_id, variant_id, completion, payload, ts)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()))
   on conflict (session_id, event_id) do nothing`;

function tsToParam(ts: unknown): string | null {
  // Accept epoch millis (number) or ISO string. Coerce millis to an ISO string the timestamptz cast
  // accepts. Anything else falls through to now() via the null + coalesce in SQL.
  if (typeof ts === "number" && Number.isFinite(ts)) return new Date(ts).toISOString();
  if (isNonEmptyString(ts)) return ts;
  return null;
}

// Map a validated AxpEvent to insert params. user_id is the caller session subject (F1), never the body.
// beat/variant ids exist as columns; episodeId has NO promoted column today, so it is preserved only in
// payload (see followup). decision_id is promoted to its column so the Outcome Joiner can close the triple.
export function axpEventToParams(userId: string | null, e: RawAxpEvent): unknown[] {
  const str = (x: unknown) => (isNonEmptyString(x) ? x : null);
  const completion =
    e.props && typeof e.props === "object" && typeof (e.props as { completion?: unknown }).completion === "number"
      ? (e.props as { completion: number }).completion
      : null;
  return [
    e.eventId,
    userId,
    str(e.seriesId),
    e.sessionId,
    e.name,
    str(e.decisionId), // decision_id: the join key from /decide, null when the event is not decision-driven
    str(e.beatId),
    str(e.variantId),
    completion,
    JSON.stringify(e),
    tsToParam(e.ts),
  ];
}

export type AxpPersistResult =
  | { ok: true; deduped: boolean }
  | { ok: false; reason: string };

// Persist a single AxpEvent. Returns deduped:true when the row already existed (ON CONFLICT DO NOTHING
// affected zero rows), so a retry of the same (session_id, event_id) is a safe no-op. We detect this via
// rowCount when the driver exposes it; a fake store without rowCount reports deduped:false.
export async function persistAxpEvent(
  sql: SqlClient,
  userId: string | null,
  e: RawAxpEvent,
): Promise<AxpPersistResult> {
  const v = validateAxpEvent(e);
  if (!v.ok) return { ok: false, reason: v.reason };
  const res = (await sql.query(INSERT_AXP_EVENT_SQL, axpEventToParams(userId, e))) as {
    rows: unknown[];
    rowCount?: number;
  };
  const deduped = typeof res.rowCount === "number" ? res.rowCount === 0 : false;
  return { ok: true, deduped };
}

// Detect whether a parsed JSON body is the canonical AxpEvent wire shape (vs the events.md batch shape).
// The AxpEvent path is keyed by a top-level `name` plus `eventId`; the batch path is `{ events: [...] }`.
export function isAxpEventBody(body: unknown): body is RawAxpEvent {
  if (body === null || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.name === "string" && typeof b.eventId === "string";
}
