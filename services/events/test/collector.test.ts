// Spec-derived tests for the engagement events collector (contracts/events/events.md + F1). Not
// implementation-mirrored: they assert the contract (valid event types persist, identity comes from the
// session not the body, idempotent ingest, a poison event does not drop the batch). No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateEvent,
  persistEvents,
  eventToParams,
  userFromAuthorization,
  EVENT_TYPES,
  type RawEvent,
  type SqlClient,
} from "../src/collector.js";

function fakeSql(): SqlClient & { calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  return { calls, async query(text, params) { calls.push({ text, params: params ?? [] }); return { rows: [] }; } };
}

const base: RawEvent = { event_id: "e1", ts: "2026-06-17T00:00:00Z", series_id: "11111111-1111-1111-1111-111111111111", session_id: "s1", type: "beat_started", decision_id: "d1", variant_id: "v1", beat_id: "b1" };

describe("validateEvent", () => {
  it("accepts every frozen event type", () => {
    for (const t of EVENT_TYPES) assert.equal(validateEvent({ ...base, type: t }).ok, true, `type ${t}`);
  });
  it("requires event_id and session_id", () => {
    assert.equal(validateEvent({ ...base, event_id: "" }).ok, false);
    assert.equal(validateEvent({ ...base, session_id: undefined }).ok, false);
  });
  it("rejects an unknown type", () => {
    assert.equal(validateEvent({ ...base, type: "nope" }).ok, false);
  });
  it("rejects a user_id in the body (F1)", () => {
    const v = validateEvent({ ...base, user_id: "aaaaaaaa-0000-0000-0000-000000000001" } as RawEvent);
    assert.equal(v.ok, false);
  });
  it("rejects a non-numeric completion", () => {
    assert.equal(validateEvent({ ...base, type: "beat_completed", completion: "1" as unknown as number }).ok, false);
  });
});

describe("persistEvents", () => {
  it("persists valid events and stamps the caller-supplied user_id, never the body", async () => {
    const sql = fakeSql();
    const r = await persistEvents(sql, "aaaaaaaa-0000-0000-0000-000000000001", [{ ...base }, { ...base, event_id: "e2", type: "beat_completed", completion: 0.9 }]);
    assert.equal(r.accepted, 2);
    assert.equal(r.rejected.length, 0);
    assert.equal(sql.calls.length, 2);
    // param 2 is user_id (the session subject)
    assert.equal(sql.calls[0].params[1], "aaaaaaaa-0000-0000-0000-000000000001");
    // completion (param 9) promoted for beat_completed
    assert.equal(sql.calls[1].params[8], 0.9);
  });
  it("rejects a poison event without dropping the valid ones in the batch", async () => {
    const sql = fakeSql();
    const r = await persistEvents(sql, null, [{ ...base }, { event_id: "bad", session_id: "s1", type: "garbage" } as RawEvent, { ...base, event_id: "e3" }]);
    assert.equal(r.accepted, 2);
    assert.equal(r.rejected.length, 1);
    assert.equal(sql.calls.length, 2);
  });
  it("uses an idempotent insert (on conflict do nothing) keyed by session_id + event_id", async () => {
    const sql = fakeSql();
    await persistEvents(sql, null, [{ ...base }]);
    assert.match(sql.calls[0].text, /on conflict \(session_id, event_id\) do nothing/i);
  });
  it("anon (null user) still logs the event", async () => {
    const sql = fakeSql();
    const r = await persistEvents(sql, null, [{ ...base }]);
    assert.equal(r.accepted, 1);
    assert.equal(sql.calls[0].params[1], null);
  });
});

describe("eventToParams", () => {
  it("keeps the full event in the payload column so no field is lost", () => {
    const p = eventToParams("u1", { ...base, extra_field: 7 } as RawEvent);
    const payload = JSON.parse(p[9] as string);
    assert.equal(payload.extra_field, 7);
    assert.equal(payload.type, "beat_started");
  });
});

describe("userFromAuthorization (F1 identity from session)", () => {
  it("extracts the uuid from a session bearer", () => {
    assert.equal(userFromAuthorization("Bearer session:aaaaaaaa-0000-0000-0000-000000000001"), "aaaaaaaa-0000-0000-0000-000000000001");
  });
  it("returns null for a non-session or malformed token", () => {
    assert.equal(userFromAuthorization("Bearer demo-token"), null);
    assert.equal(userFromAuthorization("Bearer session:not-a-uuid"), null);
    assert.equal(userFromAuthorization(undefined), null);
  });
});
