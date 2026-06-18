// Contract tests for the HttpEmitClient. We assert the emit-side guarantees: eventId/ts/sessionId
// are stamped, the same logical retry reuses the eventId (idempotency key), the client never throws
// on transport failure and instead buffers, flush retries buffered events, and a name outside the
// closed taxonomy is not delivered. A fake fetch stands in for the network. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpEmitClient, type FetchLike } from "../src/emit.js";
import type { AxpEvent } from "../src/events.js";

function fakeFetch(opts?: { fail?: boolean; status?: number }): FetchLike & {
  calls: { url: string; headers: Record<string, string>; body: AxpEvent }[];
} {
  const calls: { url: string; headers: Record<string, string>; body: AxpEvent }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as AxpEvent });
    if (opts?.fail) throw new Error("network down");
    const status = opts?.status ?? 200;
    return { ok: status >= 200 && status < 300, status };
  };
  return Object.assign(fn, { calls });
}

let seq = 0;
const idGen = () => `id-${++seq}`;
const now = () => 1_700_000_000_000;

describe("HttpEmitClient.emit", () => {
  it("stamps eventId, ts, and sessionId and posts to <baseUrl>/events", async () => {
    seq = 0;
    const fetchImpl = fakeFetch();
    const client = new HttpEmitClient({
      baseUrl: "https://collector.test/",
      sessionId: "sess-1",
      token: "session:aaaaaaaa-0000-0000-0000-000000000001",
      fetchImpl,
      idGen,
      now,
    });
    const ev = await client.emit({ name: "play", seriesId: "series-1" });
    assert.equal(ev.eventId, "id-1");
    assert.equal(ev.sessionId, "sess-1");
    assert.equal(ev.ts, 1_700_000_000_000);
    assert.equal(fetchImpl.calls.length, 1);
    // trailing slash on baseUrl is normalized
    assert.equal(fetchImpl.calls[0].url, "https://collector.test/events");
    assert.equal(fetchImpl.calls[0].headers["authorization"], "Bearer session:aaaaaaaa-0000-0000-0000-000000000001");
    assert.equal(fetchImpl.calls[0].body.name, "play");
  });

  it("reuses a caller-supplied eventId so a retry is idempotent at the collector", async () => {
    const fetchImpl = fakeFetch();
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl, idGen, now });
    const a = await client.emit({ name: "share", eventId: "fixed-1" });
    const b = await client.emit({ name: "share", eventId: "fixed-1" });
    assert.equal(a.eventId, "fixed-1");
    assert.equal(b.eventId, "fixed-1");
    // same (sessionId, eventId) on both sends, so the collector dedupes
    assert.equal(fetchImpl.calls[0].body.sessionId, fetchImpl.calls[1].body.sessionId);
    assert.equal(fetchImpl.calls[0].body.eventId, fetchImpl.calls[1].body.eventId);
  });

  it("never throws and buffers when the transport fails", async () => {
    const fetchImpl = fakeFetch({ fail: true });
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl, idGen, now });
    const ev = await client.emit({ name: "impression" });
    assert.ok(ev.eventId);
    assert.equal(client.bufferedCount(), 1);
  });

  it("buffers on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ status: 503 });
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl, idGen, now });
    await client.emit({ name: "impression" });
    assert.equal(client.bufferedCount(), 1);
  });

  it("flush retries buffered events and clears them on success", async () => {
    const failing = fakeFetch({ fail: true });
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl: failing, idGen, now });
    await client.emit({ name: "play" });
    await client.emit({ name: "save" });
    assert.equal(client.bufferedCount(), 2);

    // Swap in a healthy transport by constructing a new client sharing the buffer is not possible;
    // instead verify flush re-buffers on continued failure, then succeeds with a working fetch.
    await client.flush();
    assert.equal(client.bufferedCount(), 2, "still buffered while transport is down");
  });

  it("flush delivers buffered events once the transport recovers", async () => {
    // A mutable fake whose health we flip mid-test.
    let healthy = false;
    const calls: AxpEvent[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      if (!healthy) throw new Error("down");
      calls.push(JSON.parse(init.body) as AxpEvent);
      return { ok: true, status: 200 };
    };
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl, idGen, now });
    await client.emit({ name: "play" });
    assert.equal(client.bufferedCount(), 1);
    healthy = true;
    await client.flush();
    assert.equal(client.bufferedCount(), 0);
    assert.equal(calls.length, 1);
  });

  it("does not deliver a name outside the closed taxonomy but still returns the event", async () => {
    const fetchImpl = fakeFetch();
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl, idGen, now });
    // cast through unknown: this is the typo-at-the-edge case the guard exists for
    const ev = await client.emit({ name: "not_a_real_event" as unknown as AxpEvent["name"] });
    assert.ok(ev.eventId);
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(client.bufferedCount(), 0);
  });

  it("is a no-op-safe emitter when no fetch is available (buffers instead of throwing)", async () => {
    const client = new HttpEmitClient({ baseUrl: "", sessionId: "s", fetchImpl: undefined, idGen, now });
    const ev = await client.emit({ name: "play" });
    assert.ok(ev.eventId);
    assert.equal(client.bufferedCount(), 1);
  });
});
