// Contract tests for the canonical AxpEvent ingest path. We assert: only taxonomy names persist,
// identity is the caller session subject (F1, never the body userId), and ingest is idempotent on
// (session_id, event_id) so the same event inserts once. The fake store simulates the real unique
// constraint + ON CONFLICT DO NOTHING by keying inserted rows on (session_id, event_id) and reporting
// rowCount=0 on a duplicate. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateAxpEvent,
  persistAxpEvent,
  axpEventToParams,
  isAxpEventBody,
  AXP_EVENT_NAMES,
  type RawAxpEvent,
} from "../src/axp-collector.js";
import type { SqlClient } from "../src/collector.js";

// In-memory store that enforces the (session_id, event_id) idempotency the DB enforces. Param indexes
// match INSERT_AXP_EVENT_SQL: $4 session_id, $1 event_id, $2 user_id, $5 type.
function fakeStore(): SqlClient & { rows: Map<string, unknown[]>; inserts: number } {
  const rows = new Map<string, unknown[]>();
  const store = {
    rows,
    inserts: 0,
    async query(_text: string, params?: unknown[]) {
      const p = params ?? [];
      const key = `${String(p[3])}::${String(p[0])}`;
      if (rows.has(key)) return { rows: [], rowCount: 0 };
      rows.set(key, p);
      store.inserts++;
      return { rows: [], rowCount: 1 };
    },
  };
  return store;
}

const base: RawAxpEvent = {
  eventId: "evt-1",
  sessionId: "sess-1",
  name: "play",
  seriesId: "11111111-1111-1111-1111-111111111111",
  beatId: "b1",
  variantId: "v1",
  ts: "2026-06-18T00:00:00Z",
};

describe("validateAxpEvent", () => {
  it("accepts every name in the canonical taxonomy", () => {
    for (const name of AXP_EVENT_NAMES) {
      assert.equal(validateAxpEvent({ ...base, name }).ok, true, `name ${name}`);
    }
  });
  it("requires eventId, sessionId, and name", () => {
    assert.equal(validateAxpEvent({ ...base, eventId: "" }).ok, false);
    assert.equal(validateAxpEvent({ ...base, sessionId: undefined }).ok, false);
    assert.equal(validateAxpEvent({ ...base, name: undefined }).ok, false);
  });
  it("rejects a name outside the taxonomy", () => {
    assert.equal(validateAxpEvent({ ...base, name: "not_real" }).ok, false);
  });
  it("rejects a non-numeric propensity", () => {
    assert.equal(validateAxpEvent({ ...base, propensity: "0.5" }).ok, false);
  });
});

describe("persistAxpEvent idempotency", () => {
  it("inserts a valid taxonomy event once and stamps the caller user_id (F1)", async () => {
    const sql = fakeStore();
    const r = await persistAxpEvent(sql, "aaaaaaaa-0000-0000-0000-000000000001", { ...base });
    assert.equal(r.ok, true);
    assert.equal(sql.inserts, 1);
    const row = sql.rows.get("sess-1::evt-1")!;
    assert.equal(row[1], "aaaaaaaa-0000-0000-0000-000000000001", "user_id is the session subject");
    assert.equal(row[4], "play", "name written to the type column");
  });

  it("inserts only once for the same (session_id, event_id) and reports deduped on the retry", async () => {
    const sql = fakeStore();
    const first = await persistAxpEvent(sql, null, { ...base });
    const second = await persistAxpEvent(sql, null, { ...base });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(sql.inserts, 1, "the duplicate did not insert a second row");
    assert.deepEqual(first, { ok: true, deduped: false });
    assert.deepEqual(second, { ok: true, deduped: true });
  });

  it("treats the same event_id under a different session as a distinct row", async () => {
    const sql = fakeStore();
    await persistAxpEvent(sql, null, { ...base });
    await persistAxpEvent(sql, null, { ...base, sessionId: "sess-2" });
    assert.equal(sql.inserts, 2);
  });

  it("never stamps a userId from the event body (F1): the body hint is ignored", async () => {
    const sql = fakeStore();
    await persistAxpEvent(sql, "session-subject-1", {
      ...base,
      userId: "spoofed-user-from-body",
    } as RawAxpEvent);
    const row = sql.rows.get("sess-1::evt-1")!;
    assert.equal(row[1], "session-subject-1");
  });

  it("rejects an event with a name outside the taxonomy and does not insert", async () => {
    const sql = fakeStore();
    const r = await persistAxpEvent(sql, null, { ...base, name: "garbage" });
    assert.equal(r.ok, false);
    assert.equal(sql.inserts, 0);
  });

  it("keeps the whole event in payload so no field is lost", async () => {
    const sql = fakeStore();
    await persistAxpEvent(sql, null, { ...base, props: { completion: 0.5 }, extra: 7 } as RawAxpEvent);
    const row = sql.rows.get("sess-1::evt-1")!;
    const payload = JSON.parse(row[9] as string);
    assert.equal(payload.extra, 7);
    assert.equal(payload.name, "play");
    // completion promoted from props.completion to its column ($9, index 8)
    assert.equal(row[8], 0.5);
  });
});

describe("axpEventToParams", () => {
  it("coerces epoch millis ts to an ISO string and leaves ISO strings intact", () => {
    const millis = axpEventToParams(null, { ...base, ts: 1_700_000_000_000 });
    assert.equal(typeof millis[10], "string");
    assert.match(millis[10] as string, /^20\d\d-\d\d-\d\dT/);
    const iso = axpEventToParams(null, { ...base, ts: "2026-06-18T00:00:00Z" });
    assert.equal(iso[10], "2026-06-18T00:00:00Z");
    const none = axpEventToParams(null, { ...base, ts: undefined });
    assert.equal(none[10], null, "missing ts falls through to now() via SQL coalesce");
  });

  it("promotes decisionId to the decision_id column (the Outcome Joiner join key, T3)", () => {
    // param index 5 is decision_id in INSERT_AXP_EVENT_SQL
    const withId = axpEventToParams(null, { ...base, decisionId: "11111111-1111-1111-1111-111111111111" });
    assert.equal(withId[5], "11111111-1111-1111-1111-111111111111");
    // an event with no decisionId (e.g. search_performed) leaves the column null, never a fabricated id
    const without = axpEventToParams(null, { ...base });
    assert.equal(without[5], null);
  });
});

describe("isAxpEventBody routing guard", () => {
  it("recognizes the AxpEvent single-event shape", () => {
    assert.equal(isAxpEventBody({ name: "play", eventId: "x", sessionId: "s" }), true);
  });
  it("does not match the legacy batch shape", () => {
    assert.equal(isAxpEventBody({ events: [] }), false);
    assert.equal(isAxpEventBody(null), false);
    assert.equal(isAxpEventBody({ name: "play" }), false, "needs eventId too");
  });
});
