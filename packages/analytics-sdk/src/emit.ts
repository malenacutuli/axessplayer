// Browser/runtime emit client for the canonical analytics taxonomy. Takes an AxpEventInput,
// stamps eventId/ts (and sessionId from config), and POSTs it to an events collector base URL.
//
// Contract guarantees:
//  - Idempotent on (sessionId, eventId): a retry reuses the same eventId so the collector dedupes.
//  - Best-effort: emit NEVER throws. A transport failure buffers the event for a later flush.
//  - Identity is the session subject (F1): no user_id is required in the body; userId is optional
//    and only carried for surfaces that already know it. The collector stamps identity from the
//    session bearer, this client just carries the optional hint.
//
// No em dashes, no emojis by project rule.

import {
  type AxpEvent,
  type AxpEventInput,
  type AxpEventEmitter,
  isAxpEventName,
} from "./events.js";

/** Minimal fetch surface this client needs. Avoids a hard DOM lib dependency. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    keepalive?: boolean;
  },
) => Promise<{ ok: boolean; status: number }>;

export interface EmitClientConfig {
  /** Events collector base URL, for example "https://events.example" or "" for same origin. */
  baseUrl: string;
  /** Default session id stamped onto events that do not carry their own. */
  sessionId?: string;
  /** Optional session bearer token sent as Authorization (collector derives identity from it, F1). */
  token?: string;
  /** Injectable fetch (defaults to globalThis.fetch). Lets tests run without a network. */
  fetchImpl?: FetchLike;
  /** Injectable id generator (defaults to crypto.randomUUID with a fallback). */
  idGen?: () => string;
  /** Injectable clock for ts stamping (defaults to Date.now). */
  now?: () => number;
  /** Max events held in the in-memory retry buffer before the oldest are dropped. Default 500. */
  maxBufferSize?: number;
}

function defaultIdGen(): string {
  const c: unknown = (globalThis as { crypto?: unknown }).crypto;
  if (c && typeof (c as { randomUUID?: unknown }).randomUUID === "function") {
    return (c as { randomUUID: () => string }).randomUUID();
  }
  // Non-crypto fallback for runtimes without crypto.randomUUID. Still unique enough for an id.
  return `axp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function resolveFetch(injected?: FetchLike): FetchLike | null {
  if (injected) return injected;
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === "function" ? (f as unknown as FetchLike) : null;
}

/**
 * Best-effort, idempotent emit client over HTTP. Implements AxpEventEmitter so it is a drop-in for
 * any surface that depends on the typed emitter interface.
 */
export class HttpEmitClient implements AxpEventEmitter {
  private readonly baseUrl: string;
  private readonly sessionId: string | undefined;
  private readonly token: string | undefined;
  private readonly fetchImpl: FetchLike | null;
  private readonly idGen: () => string;
  private readonly now: () => number;
  private readonly maxBufferSize: number;
  private readonly buffer: AxpEvent[] = [];

  constructor(config: EmitClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.sessionId = config.sessionId;
    this.token = config.token;
    this.fetchImpl = resolveFetch(config.fetchImpl);
    this.idGen = config.idGen ?? defaultIdGen;
    this.now = config.now ?? (() => Date.now());
    this.maxBufferSize = config.maxBufferSize ?? 500;
  }

  /** Materialize an input event: stamp eventId, ts, and sessionId so the idempotency key is complete. */
  private materialize(input: AxpEventInput): AxpEvent {
    const sessionId = input.sessionId ?? this.sessionId ?? "";
    return {
      ...input,
      eventId: input.eventId ?? this.idGen(),
      sessionId,
      ts: input.ts ?? this.now(),
    };
  }

  private endpoint(): string {
    return `${this.baseUrl}/events`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.token) h["authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private bufferEvent(event: AxpEvent): void {
    this.buffer.push(event);
    // Drop oldest on overflow so a long offline stretch cannot grow memory without bound.
    while (this.buffer.length > this.maxBufferSize) this.buffer.shift();
  }

  /** Send one materialized event. Returns true on a 2xx, false on any failure (never throws). */
  private async send(event: AxpEvent): Promise<boolean> {
    if (!this.fetchImpl) return false;
    try {
      const res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(event),
        keepalive: true,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Emit a single event, best-effort. Resolves with the materialized event regardless of delivery. */
  async emit(input: AxpEventInput): Promise<AxpEvent> {
    const event = this.materialize(input);
    // Guard the taxonomy at the edge so a typo never silently ships. We still return the event
    // (never throw) but we do not attempt delivery of a name outside the closed set.
    if (!isAxpEventName(event.name)) {
      return event;
    }
    const delivered = await this.send(event);
    if (!delivered) this.bufferEvent(event);
    return event;
  }

  /** Emit a batch, preserving order. Each is independently best-effort. */
  async emitBatch(inputs: readonly AxpEventInput[]): Promise<AxpEvent[]> {
    const out: AxpEvent[] = [];
    for (const input of inputs) out.push(await this.emit(input));
    return out;
  }

  /** Retry buffered events. Re-buffers any that still fail. Idempotent at the collector by key. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pending = this.buffer.splice(0, this.buffer.length);
    for (const event of pending) {
      const delivered = await this.send(event);
      if (!delivered) this.bufferEvent(event);
    }
  }

  /** Number of events currently held for retry. Exposed for tests and diagnostics. */
  bufferedCount(): number {
    return this.buffer.length;
  }
}

/** Convenience factory. Returns the typed emitter interface so call sites depend on the contract. */
export function createEmitClient(config: EmitClientConfig): AxpEventEmitter & {
  bufferedCount(): number;
} {
  return new HttpEmitClient(config);
}
