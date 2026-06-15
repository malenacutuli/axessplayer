// The capture client must envelope events, be consent-gated, ship without a user_id (F1), and no-op without
// a collector. No em dashes.
import { describe, it, expect, vi } from "vitest";
import { createCaptureClient, noopCapture } from "./capture.js";

describe("capture client", () => {
  it("envelopes events with series, session, event_id, and ts", () => {
    const c = createCaptureClient({ seriesId: "s1", sessionId: "sess" });
    c.emit({ type: "beat_started", beat_id: "b1", variant_id: "v1" });
    const evs = c.buffered();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: "beat_started", beat_id: "b1", series_id: "s1", session_id: "sess" });
    expect(evs[0].event_id).toBeTruthy();
    expect(evs[0].ts).toBeTruthy();
  });

  it("is consent-gated: emits nothing when enabled() is false", () => {
    const c = createCaptureClient({ seriesId: "s1", enabled: () => false });
    c.emit({ type: "beat_started", beat_id: "b1" });
    expect(c.buffered()).toHaveLength(0);
  });

  it("flush POSTs the batch to the collector and never carries user_id (F1)", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof globalThis.fetch;
    const c = createCaptureClient({ seriesId: "s1", baseUrl: "http://collector", fetch });
    c.emit({ type: "beat_completed", beat_id: "b1", completion: 1 });
    await c.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call[0]).toBe("http://collector/events");
    const body = JSON.parse(call[1].body as string);
    expect(body.events[0]).toMatchObject({ type: "beat_completed", beat_id: "b1", completion: 1 });
    expect(JSON.stringify(body)).not.toContain("user_id");
  });

  it("flush is a no-op without a collector url", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const c = createCaptureClient({ seriesId: "s1", fetch });
    c.emit({ type: "beat_started", beat_id: "b1" });
    await c.flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("noopCapture emits nothing", () => {
    noopCapture.emit({ type: "beat_started", beat_id: "b" });
    expect(noopCapture.buffered()).toHaveLength(0);
  });
});
