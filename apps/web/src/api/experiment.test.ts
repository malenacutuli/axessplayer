// 25-D2 experiment client tests. Selection normalizes a sparse service response and resolves to null when
// unreachable or empty (so the caller falls back to the existing poster); impression/click POST to the
// service and are best-effort (a failure never throws). Identity rides the session token, never a body
// field (the shared apiFetch enforces F1). No em dashes.

import { describe, it, expect, vi } from "vitest";
import { createExperimentClient } from "./experiment.js";
import { staticSession } from "./session.js";

const BASE = "http://exp";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("experiment client", () => {
  it("selects a per-viewer poster from the set", async () => {
    const fetch = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/poster/select?set=s1&unit=viewer-1");
      return jsonResponse({ posterId: "p9", url: "http://cdn/p9.png", propensity: 0.4 });
    }) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });

    const sel = await client.selectPoster("s1", "viewer-1");
    expect(sel).toEqual({ posterId: "p9", url: "http://cdn/p9.png", propensity: 0.4, accessibilityFirst: undefined, candidates: undefined });
  });

  it("normalizes snake_case and candidates", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        poster_id: "p1",
        url: "http://cdn/p1.png",
        accessibility_first: true,
        candidates: [{ poster_id: "a", url: "http://cdn/a.png", accessibility_first: true, tags: ["calm"] }],
      }),
    ) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });

    const sel = await client.selectPoster("s1", "u1");
    expect(sel?.posterId).toBe("p1");
    expect(sel?.accessibilityFirst).toBe(true);
    expect(sel?.candidates?.[0]).toEqual({ posterId: "a", url: "http://cdn/a.png", accessibilityFirst: true, tags: ["calm"] });
  });

  it("resolves to null when the set is empty (no poster id)", async () => {
    const fetch = vi.fn(async () => jsonResponse({})) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });
    expect(await client.selectPoster("s1", "u1")).toBeNull();
  });

  it("resolves to null when the service is unreachable (graceful fallback)", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });
    expect(await client.selectPoster("s1", "u1")).toBeNull();
  });

  it("resolves to null and never calls fetch when no base url is configured", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: "", session: staticSession("t"), fetch });
    expect(await client.selectPoster("s1", "u1")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs an impression with the viewer unit and propensity", async () => {
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/poster/impression");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ seriesId: "s1", posterId: "p1", unit: "u1", propensity: 0.5 });
      return jsonResponse({ ok: true });
    }) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });
    await client.logImpression({ seriesId: "s1", posterId: "p1", unit: "u1", propensity: 0.5 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("swallows a failed click log (best-effort, never throws)", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "x" }, 500)) as unknown as typeof globalThis.fetch;
    const client = createExperimentClient({ baseUrl: BASE, session: staticSession("t"), fetch });
    await expect(client.logClick({ seriesId: "s1", posterId: "p1", unit: "u1" })).resolves.toBeUndefined();
  });
});
