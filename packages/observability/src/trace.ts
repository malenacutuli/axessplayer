// Trace-context helpers: extract and propagate a trace id across the fetch boundary.
//
// Two header conventions are supported, in priority order:
//   1. W3C `traceparent` (https://www.w3.org/TR/trace-context/), the standard OTel uses.
//      Format: version-traceid-parentid-flags, e.g.
//      00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
//   2. A plain `x-request-id` / `x-trace-id` fallback for callers that do not speak W3C.
//
// This module is dependency-free and works against the Web `Headers` type (and any
// header bag exposing `get(name)`), so it is identical on the app, edge, and Node sides.
// No live exporter is involved; this only moves an id across a boundary. No em dashes.

export const TRACEPARENT_HEADER = "traceparent";
export const REQUEST_ID_HEADER = "x-request-id";
export const TRACE_ID_HEADER = "x-trace-id";

// A minimal trace context. `traceId` is always present (generated if absent on the wire).
// `spanId` is the id of the current span, used as the parent when propagating downstream.
// `sampled` mirrors the W3C sampled flag; defaults to true when we mint a fresh context.
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

// Any object that can read a header by name. Web `Headers` satisfies this, as does a
// plain `{ get(name) }` shim, so callers are not forced to construct a `Headers`.
export interface HeaderReader {
  get(name: string): string | null;
}

const HEX = "0123456789abcdef";

// 16 random hex chars (64 bits) for a span id; 32 (128 bits) for a trace id.
function randomHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function newTraceId(): string {
  return randomHex(32);
}

export function newSpanId(): string {
  return randomHex(16);
}

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const ALL_ZERO_TRACE = "00000000000000000000000000000000";
const ALL_ZERO_SPAN = "0000000000000000";

// Parse a W3C `traceparent` header. Returns null when malformed or all-zero (per spec,
// an all-zero trace id is invalid and must be replaced with a fresh one).
export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length < 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version.length !== 2) return null;
  if (!TRACE_ID_RE.test(traceId) || traceId === ALL_ZERO_TRACE) return null;
  if (!SPAN_ID_RE.test(spanId) || spanId === ALL_ZERO_SPAN) return null;
  const flagByte = Number.parseInt(flags, 16);
  if (Number.isNaN(flagByte)) return null;
  return { traceId, spanId, sampled: (flagByte & 0x01) === 0x01 };
}

// Serialize a context back into a W3C `traceparent` value for the downstream hop.
export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled ? "01" : "00";
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// Read a trace context off an incoming request. Tries `traceparent` first, then the
// plain `x-request-id` / `x-trace-id` fallback, and finally mints a fresh context so the
// caller always has a usable id. The returned `spanId` is the local span: for W3C input it
// is freshly minted (the inbound span id becomes the parent only when re-propagated), and
// for every other path it is freshly minted too.
export function extractTraceContext(headers: HeaderReader): TraceContext {
  const w3c = parseTraceparent(headers.get(TRACEPARENT_HEADER));
  if (w3c) {
    // Continue the inbound trace, but start a new local span.
    return { traceId: w3c.traceId, spanId: newSpanId(), sampled: w3c.sampled };
  }

  const plain = headers.get(REQUEST_ID_HEADER) ?? headers.get(TRACE_ID_HEADER);
  if (plain && plain.trim().length > 0) {
    return { traceId: plain.trim(), spanId: newSpanId(), sampled: true };
  }

  return { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
}

// Write the trace context onto an outgoing request's headers so the next hop can continue
// it. Sets both the W3C `traceparent` and the plain `x-request-id` for non-W3C consumers.
// Accepts the Web `Headers` type or a plain record; returns the same shape it was given.
export function injectTraceContext<T extends Headers | Record<string, string>>(
  headers: T,
  ctx: TraceContext,
): T {
  const traceparent = formatTraceparent(ctx);
  if (headers instanceof Headers) {
    headers.set(TRACEPARENT_HEADER, traceparent);
    headers.set(REQUEST_ID_HEADER, ctx.traceId);
    return headers;
  }
  (headers as Record<string, string>)[TRACEPARENT_HEADER] = traceparent;
  (headers as Record<string, string>)[REQUEST_ID_HEADER] = ctx.traceId;
  return headers;
}

// Build the header object to spread into a `fetch` call for the downstream hop.
export function traceHeaders(ctx: TraceContext): Record<string, string> {
  return injectTraceContext<Record<string, string>>({}, ctx);
}
