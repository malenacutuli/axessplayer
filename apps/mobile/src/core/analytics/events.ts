// Viewership events: POST {EVENTS_BASE}/events with one JSON event per call. Every send goes through the
// consent gate (isAllowed), which is checked at SEND time, so revoking consent stops events immediately.
// Delivery is best effort: failures are swallowed and never surface to the viewer. The bearer is attached
// when signed in, like every other call.
//
// Wire format. The app models events as ViewEvent (the P8 brief: event_id, session_id, type, video_id,
// position_ms, value, ts). The events collector on the platform branch ingests the analytics-sdk
// AxpEvent shape instead ({ eventId, sessionId, name, ts, props }, closed taxonomy, idempotent on
// sessionId + eventId) and rejects unknown names. wire: "axp" (default) maps each ViewEvent onto that
// taxonomy; wire: "flat" posts the ViewEvent as is. No em dashes.

import { createHttp, type TokenProvider } from "../api/http";
import { defaultUuid, type IdFactory } from "../id";

export type ViewEventType =
  | "impression"
  | "play"
  | "quartile"
  | "complete"
  | "seek"
  | "a11y_toggle"
  // platform v2 extras that the collector taxonomy already names
  | "video_opened"
  | "sponsor_shown"
  | "tip_sent";

export type WireFormat = "axp" | "flat";

// Optional per-video context carried in AxpEvent props (the web app sends the same keys).
export interface VideoContext {
  channelId?: string;
  format?: string;
  orientation?: string;
}

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
  context?: VideoContext;
}

export interface AxpWireEvent {
  eventId: string;
  sessionId: string;
  name: string;
  ts: string;
  props: Record<string, unknown>;
}

// Taxonomy name for a ViewEvent. Quartiles become completion_25/50/75, complete becomes completion_100,
// caption toggles caption_toggled, audio track changes (dubs, audio description) language_switched or
// ad_toggled.
export function axpName(ev: Pick<ViewEvent, "type" | "value">): string {
  switch (ev.type) {
    case "quartile":
      return ev.value === 25 || ev.value === 50 || ev.value === 75 ? `completion_${ev.value}` : "completion_50";
    case "complete":
      return "completion_100";
    case "a11y_toggle": {
      const v = String(ev.value ?? "");
      if (v.startsWith("audio_description")) return "ad_toggled";
      if (v.startsWith("sign")) return "sign_toggled";
      if (v.startsWith("audio:")) return "language_switched";
      return "caption_toggled";
    }
    default:
      return ev.type;
  }
}

export function toAxpWire(ev: ViewEvent, context?: VideoContext): AxpWireEvent {
  const props: Record<string, unknown> = { videoId: ev.video_id, positionMs: ev.position_ms };
  if (ev.value !== undefined) props.value = ev.value;
  if (ev.type === "quartile" || ev.type === "complete") props.completion = ev.type === "complete" ? 1 : Number(ev.value) / 100;
  if (context?.channelId) props.channelId = context.channelId;
  if (context?.format) props.format = context.format;
  if (context?.orientation) props.orientation = context.orientation;
  return { eventId: ev.event_id, sessionId: ev.session_id, name: axpName(ev), ts: ev.ts, props };
}

export interface EventsClientOptions {
  isAllowed: () => boolean;
  getAccessToken: TokenProvider;
  fetch?: typeof globalThis.fetch;
  newId?: IdFactory;
  now?: () => Date;
  sessionId?: string;
  wire?: WireFormat;
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
      const ev = build(input);
      const body = (opts.wire ?? "axp") === "axp" ? toAxpWire(ev, input.context) : ev;
      const res = await http.request({ method: "POST", url, body }, () => true);
      return res.ok;
    },
  };
}
