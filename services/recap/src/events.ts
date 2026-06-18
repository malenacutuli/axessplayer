// Event sink for the recap service. The recap engine emits three analytics events documented in the
// handoff (Recap engine -> Instrumentation):
//   recap_shown            on assembly, carrying { beats, variantIds }
//   recap_skipped          when the viewer skips the recap
//   continued_after_recap  when the viewer continues into the episode
//
// The prototype logged to window.__axpRecapEvents + console + an on-screen strip. The production target is
// the engagement events stream (mobile.engagement_events), collected today by services/events. This file
// deliberately exposes a SMALL EventSink interface and ships a console-backed stub.
//
// TODO (wiring, not in this slice): replace ConsoleEventSink with an sink that batches to the events
// collector (services/events POST /events) or inserts into mobile.engagement_events using the existing
// INSERT shape (event_id, user_id, series_id, session_id, type, decision_id, beat_id, variant_id,
// completion, payload, ts). Do NOT add a migration: the mobile schema is frozen and already has the table.
// No em dashes.

export type RecapEventType = "recap_shown" | "recap_skipped" | "continued_after_recap";

export interface RecapEvent {
  type: RecapEventType;
  userId: string;
  seriesId: string;
  // Free-form, event-specific payload. For recap_shown this is { beats, variantIds }.
  payload: Record<string, unknown>;
  // ISO timestamp set by the emitter. Kept on the event so a future DB sink maps it straight to the ts
  // column rather than stamping its own clock.
  ts: string;
}

export interface EventSink {
  emit(event: RecapEvent): Promise<void>;
}

// Console-backed stub sink. Deterministic, dependency-free, safe in tests. Logs a single structured line
// per event so the stream is visible during local bring-up. Swap for a DB/collector sink in production.
export class ConsoleEventSink implements EventSink {
  async emit(event: RecapEvent): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`recap.event ${JSON.stringify(event)}`);
  }
}

// Helper builders so the HTTP layer cannot mistype an event type or forget the recap_shown payload shape.
export function recapShownEvent(args: {
  userId: string;
  seriesId: string;
  beats: number;
  variantIds: string[];
  ts: string;
}): RecapEvent {
  return {
    type: "recap_shown",
    userId: args.userId,
    seriesId: args.seriesId,
    payload: { beats: args.beats, variantIds: args.variantIds },
    ts: args.ts,
  };
}

export function recapSkippedEvent(args: { userId: string; seriesId: string; ts: string }): RecapEvent {
  return { type: "recap_skipped", userId: args.userId, seriesId: args.seriesId, payload: {}, ts: args.ts };
}

export function continuedAfterRecapEvent(args: { userId: string; seriesId: string; ts: string }): RecapEvent {
  return {
    type: "continued_after_recap",
    userId: args.userId,
    seriesId: args.seriesId,
    payload: {},
    ts: args.ts,
  };
}
