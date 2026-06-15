// Phase 0 beat-level capture: the flywheel's input. Emits the frozen events (contracts/events/events.md)
// with a common envelope, buffered and best-effort shipped to an events collector. CONSENT-GATED: nothing
// is emitted unless the viewer granted analytics_personalization (apps/web/src/consent). F1: the wire body
// never carries user_id; the collector stamps it from the session subject. The collector endpoint is the
// cutover seam (VITE_EVENTS_BASE_URL); without it this buffers locally and is a no-op on the wire. No em
// dashes.

// The event payloads mirror the frozen contract shapes. decision_id joins to decision_log.id for reward
// attribution (the whole point of the flywheel).
export type CaptureEvent =
  | { type: "beat_started"; beat_id: string; decision_id?: string; variant_id?: string; is_control?: boolean }
  | { type: "beat_completed"; beat_id: string; decision_id?: string; variant_id?: string; completion: number }
  | { type: "beat_skipped"; beat_id: string; decision_id?: string; variant_id?: string; at_completion: number }
  | { type: "choice_made"; beat_id: string; decision_id?: string; choice: string; latency_ms: number }
  | { type: "session_ended"; last_beat_id: string; total_ms: number };

export interface EnvelopedEvent extends Record<string, unknown> {
  event_id: string;
  ts: string;
  series_id: string;
  session_id: string;
}

export interface CaptureClient {
  emit(event: CaptureEvent): void;
  flush(): Promise<void>;
  // For inspection and tests: the events emitted this session (post consent-gate).
  buffered(): ReadonlyArray<EnvelopedEvent>;
}

export const noopCapture: CaptureClient = {
  emit() {},
  async flush() {},
  buffered() {
    return [];
  },
};

export interface CaptureOptions {
  seriesId: string;
  sessionId?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  // Consent gate: emission only happens when this returns true (analytics_personalization granted).
  enabled?: () => boolean;
}

function eventId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function createCaptureClient(opts: CaptureOptions): CaptureClient {
  const sessionId = opts.sessionId ?? eventId();
  const buffer: EnvelopedEvent[] = [];
  const unsent: EnvelopedEvent[] = [];
  const baseUrl = opts.baseUrl ?? readEventsBaseUrl();
  const isEnabled = () => (opts.enabled ? opts.enabled() : true);

  return {
    emit(event) {
      if (!isEnabled()) return; // consent gate: opted-out viewers produce no events
      const enveloped: EnvelopedEvent = {
        event_id: eventId(),
        ts: new Date().toISOString(),
        series_id: opts.seriesId,
        session_id: sessionId,
        ...event,
      };
      buffer.push(enveloped);
      unsent.push(enveloped);
      // Ship session_ended promptly; batch the rest. Best-effort, never throws to the UI.
      if (event.type === "session_ended") void this.flush();
    },
    async flush() {
      if (!baseUrl || unsent.length === 0) return;
      const batch = unsent.splice(0, unsent.length);
      const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
      try {
        // No user_id in the body (F1): the collector derives it from the session bearer.
        await doFetch(`${baseUrl.replace(/\/$/, "")}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: batch }),
          keepalive: true,
        });
      } catch {
        // Re-queue on failure so a later flush retries; never surface to the UI.
        unsent.unshift(...batch);
      }
    },
    buffered() {
      return buffer;
    },
  };
}

function readEventsBaseUrl(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_EVENTS_BASE_URL || undefined;
}
