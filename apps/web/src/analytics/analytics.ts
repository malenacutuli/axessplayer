// The viewer-surface analytics seam. The onboarding cold open (20-V1) and the discover surfaces
// (20-V3) emit canonical events from packages/analytics-sdk through ONE thin wrapper so every surface
// uses the same closed taxonomy and the same envelope. This is the "no dead end" guarantee in code:
// every control emits its event even before its backend exists.
//
// Identity is the session subject (F1): we never put a user_id in a body; the collector stamps it from
// the bearer token. Without VITE_EVENTS_BASE_URL the emitter buffers in memory and is a no-op on the
// wire, which is fine for the demo and tests. No em dashes.

import {
  createEmitClient,
  type AxpEvent,
  type AxpEventEmitter,
  type AxpEventInput,
  type AxpEventName,
  type AxpEventProps,
} from "@axessplayer/analytics-sdk";
import type { SessionProvider } from "../api/session.js";

export interface ViewerAnalytics {
  // Fire-and-forget emit. Never throws into the UI; a failed send is buffered for retry by the SDK.
  track(name: AxpEventName, props?: AxpEventProps & { seriesId?: string; episodeId?: string; beatId?: string; variantId?: string }): void;
}

function readEventsBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_EVENTS_BASE_URL ?? "";
}

export interface ViewerAnalyticsOptions {
  session?: SessionProvider;
  sessionId?: string;
  baseUrl?: string;
  // Injectable for tests.
  emitter?: AxpEventEmitter;
}

// A no-op emitter so the surfaces can always call track() unconditionally (no dead ends, no guards
// at every call site). Used when no events base url is configured.
function materializeNoop(e: AxpEventInput): AxpEvent {
  return { ...e, eventId: "noop", ts: e.ts ?? Date.now(), sessionId: e.sessionId ?? "" };
}
const noopEmitter: AxpEventEmitter = {
  async emit(e: AxpEventInput): Promise<AxpEvent> {
    return materializeNoop(e);
  },
  async emitBatch(es: readonly AxpEventInput[]): Promise<AxpEvent[]> {
    return es.map(materializeNoop);
  },
};

export function createViewerAnalytics(opts: ViewerAnalyticsOptions = {}): ViewerAnalytics {
  const baseUrl = opts.baseUrl ?? readEventsBaseUrl();
  const emitter =
    opts.emitter ??
    (baseUrl ? createEmitClient({ baseUrl, sessionId: opts.sessionId }) : noopEmitter);

  // Pull the bearer token lazily and best-effort; the emit client itself is constructed without a token
  // when one is not yet available (the demo session is anonymous), and the collector derives identity.
  return {
    track(name, props) {
      const { seriesId, episodeId, beatId, variantId, ...rest } = props ?? {};
      void emitter
        .emit({
          name,
          sessionId: opts.sessionId,
          seriesId,
          episodeId,
          beatId,
          variantId,
          ts: Date.now(),
          props: rest,
        })
        .catch(() => {
          // Best-effort: a failed analytics send must never surface in the UI.
        });
    },
  };
}
