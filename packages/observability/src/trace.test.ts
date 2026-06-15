// Unit tests for trace-context helpers: W3C traceparent round-trip across the fetch boundary,
// plain x-request-id fallback, fresh-id minting, malformed/all-zero rejection, and header
// injection for the downstream hop. Runner: node --test + tsx. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractTraceContext,
  injectTraceContext,
  traceHeaders,
  parseTraceparent,
  formatTraceparent,
  newTraceId,
  newSpanId,
  TRACEPARENT_HEADER,
  REQUEST_ID_HEADER,
} from "./trace.js";

test("new ids are correctly sized lowercase hex", () => {
  assert.match(newTraceId(), /^[0-9a-f]{32}$/);
  assert.match(newSpanId(), /^[0-9a-f]{16}$/);
});

test("parseTraceparent reads a valid W3C header", () => {
  const ctx = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.ok(ctx);
  assert.equal(ctx.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(ctx.spanId, "00f067aa0ba902b7");
  assert.equal(ctx.sampled, true);
});

test("parseTraceparent rejects malformed and all-zero ids", () => {
  assert.equal(parseTraceparent(""), null);
  assert.equal(parseTraceparent("garbage"), null);
  assert.equal(parseTraceparent("00-too-short-01"), null);
  assert.equal(
    parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
    null,
  );
  assert.equal(
    parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"),
    null,
  );
});

test("formatTraceparent round-trips a parsed context", () => {
  const value = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const ctx = parseTraceparent(value)!;
  // Re-serialized trace id and sampled flag match; span id is whatever the context carries.
  assert.equal(formatTraceparent(ctx), value);
});

test("extract continues an inbound W3C trace with a fresh local span", () => {
  const headers = new Headers({
    [TRACEPARENT_HEADER]: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  });
  const ctx = extractTraceContext(headers);
  assert.equal(ctx.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.notEqual(ctx.spanId, "00f067aa0ba902b7"); // new local span
  assert.match(ctx.spanId, /^[0-9a-f]{16}$/);
});

test("extract falls back to x-request-id as the trace id", () => {
  const headers = new Headers({ [REQUEST_ID_HEADER]: "req-12345" });
  const ctx = extractTraceContext(headers);
  assert.equal(ctx.traceId, "req-12345");
});

test("extract mints a fresh context when nothing is present", () => {
  const ctx = extractTraceContext(new Headers());
  assert.match(ctx.traceId, /^[0-9a-f]{32}$/);
  assert.equal(ctx.sampled, true);
});

test("trace id round-trips across the fetch boundary via inject/extract", () => {
  // Service A extracts (fresh trace), then injects onto an outgoing request to service B.
  const ctxA = extractTraceContext(new Headers());
  const outgoing = new Headers();
  injectTraceContext(outgoing, ctxA);

  // Service B receives those headers and extracts: same trace id, new local span.
  const ctxB = extractTraceContext(outgoing);
  assert.equal(ctxB.traceId, ctxA.traceId);
  assert.notEqual(ctxB.spanId, ctxA.spanId);
});

test("traceHeaders yields a spreadable record for fetch", () => {
  const ctx = { traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: false };
  const h = traceHeaders(ctx);
  assert.equal(h[TRACEPARENT_HEADER], `00-${"a".repeat(32)}-${"b".repeat(16)}-00`);
  assert.equal(h[REQUEST_ID_HEADER], "a".repeat(32));
});

test("inject works on a plain record as well as Headers", () => {
  const ctx = { traceId: "c".repeat(32), spanId: "d".repeat(16), sampled: true };
  const rec = injectTraceContext<Record<string, string>>({}, ctx);
  assert.equal(rec[REQUEST_ID_HEADER], "c".repeat(32));
});
