import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventsClient } from "./events";
import { recordingFetch } from "../test-fetch";
import { defaultUuid, UUID_RE } from "../id";

test("nothing is sent without consent", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 202 }));
  const ev = createEventsClient("https://ev", { isAllowed: () => false, getAccessToken: () => null, fetch: fetchImpl });
  assert.equal(await ev.track({ type: "play", video_id: "v1" }), false);
  assert.equal(calls.length, 0);
});

test("with consent, posts one well-formed event to /events", async () => {
  let allowed = true;
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 202 }));
  const ev = createEventsClient("https://ev/", {
    isAllowed: () => allowed,
    getAccessToken: () => "tok",
    fetch: fetchImpl,
    now: () => new Date("2026-10-01T12:00:00Z"),
  });
  assert.equal(await ev.track({ type: "quartile", video_id: "v1", position_ms: 7500.4, value: 25 }), true);
  assert.equal(calls[0].url, "https://ev/events");
  const body = calls[0].body as Record<string, unknown>;
  assert.match(String(body.event_id), UUID_RE);
  assert.equal(body.session_id, ev.sessionId);
  assert.equal(body.type, "quartile");
  assert.equal(body.position_ms, 7500);
  assert.equal(body.value, 25);
  assert.equal(body.ts, "2026-10-01T12:00:00.000Z");
  assert.equal(calls[0].headers.authorization, "Bearer tok");
  allowed = false;
  assert.equal(await ev.track({ type: "seek", video_id: "v1" }), false);
  assert.equal(calls.length, 1);
});

test("delivery failures are swallowed", async () => {
  const { fetchImpl } = recordingFetch(() => "throw");
  const ev = createEventsClient("https://ev", { isAllowed: () => true, getAccessToken: () => null, fetch: fetchImpl });
  assert.equal(await ev.track({ type: "impression", video_id: "v1" }), false);
});

test("event without value omits the key and clamps negative positions", () => {
  const ev = createEventsClient("https://ev", { isAllowed: () => true, getAccessToken: () => null });
  const e = ev.build({ type: "impression", video_id: "v", position_ms: -3 });
  assert.equal("value" in e, false);
  assert.equal(e.position_ms, 0);
  assert.match(defaultUuid(), UUID_RE);
});
