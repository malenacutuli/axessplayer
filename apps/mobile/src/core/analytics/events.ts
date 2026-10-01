// Viewership events: POST {EVENTS_BASE}/events with one JSON event per call. Every send goes through the
// consent gate (isAllowed), which is checked at SEND time, so revoking consent stops events immediately.
// Delivery is best effort: failures are swallowed and never surface to the viewer. The bearer is attached
// when signed in, like every other call. No em dashes.

import { createHttp, type TokenProvider } from "../api/http";
import { defaultUuid, type IdFactory } from "../id";

export type ViewEventType = "impression" | "play" | "quartile" | "complete" | "seek" | "a11y_toggle";

export interface ViewEvent {
  event_id: string;
  session_id: string;
  type: ViewEventType;
  video_id: string;
  position_ms: number;
  value?: string | number | boolean;
  ts: string;
}

export interface TrackInput {
  type: ViewEventType;
  video_id: string;
  position_ms?: number;
  value?: string | number | boolean;
}

export interface EventsClientOptions {
  isAllowed: () => boolean;
  getAccessToken: TokenProvider;
  fetch?: typeof globalThis.fetch;
  newId?: IdFactory;
  now?: () => Date;
  sessionId?: string;
}

export interface EventsClient {
  readonly sessionId: string;
  // Resolves to true when the event was accepted by the server, false when gated or failed.
  track(input: TrackInput): Promise<boolean>;
  build(input: TrackInput): ViewEvent;
}

export function createEventsClient(baseUrl: string, opts: EventsClientOptions): EventsClient {
  const newId = opts.newId ?? defaultUuid;
  const now = opts.now ?? (() => new Date());
  const sessionId = opts.sessionId ?? newId();
  const http = createHttp({ getAccessToken: opts.getAccessToken, fetch: opts.fetch, timeoutMs: 10000 });
  const url = `${baseUrl.replace(/\/+$/, "")}/events`;

  function build(input: TrackInput): ViewEvent {
    const pos = Math.max(0, Math.round(input.position_ms ?? 0));
    const ev: ViewEvent = {
      event_id: newId(),
      session_id: sessionId,
      type: input.type,
      video_id: input.video_id,
      position_ms: Number.isFinite(pos) ? pos : 0,
      ts: now().toISOString(),
    };
    if (input.value !== undefined) ev.value = input.value;
    return ev;
  }

  return {
    sessionId,
    build,
    async track(input) {
      if (!opts.isAllowed()) return false;
      const res = await http.request({ method: "POST", url, body: build(input) }, () => true);
      return res.ok;
    },
  };
}
