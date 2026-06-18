// Unit tests for the catalog client. It binds to the CATALOG API CONTRACT and goes through the shared
// apiFetch (session bearer attached, identity never in a body). We assert the request shapes and that
// the array endpoints tolerate both a bare array and an { items } envelope. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { createCatalogClient } from "./catalog.js";
import { staticSession } from "./session.js";

const session = staticSession("tok");

function jsonFetch(payload: unknown, status = 200): { fetch: typeof globalThis.fetch; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("catalog client", () => {
  it("POSTs /calibrate with the contract body and returns the payoff", async () => {
    const { fetch, calls } = jsonFetch({ summary: "slow burn, your POV, English", badge: "CUT FOR YOU" });
    const c = createCatalogClient({ baseUrl: "http://x", session, fetch });
    const res = await c.calibrate({ pace: "slow_burn", pov: "protagonist", intensity: 0.6 });
    expect(res.badge).toBe("CUT FOR YOU");
    expect(calls[0][0]).toBe("http://x/calibrate");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ pace: "slow_burn", pov: "protagonist", intensity: 0.6 });
  });

  it("GET /continue tolerates a bare array", async () => {
    const { fetch } = jsonFetch([{ seriesId: "s1", title: "T", poster: null, beatId: "b1", progress: 0.3 }]);
    const c = createCatalogClient({ baseUrl: "http://x", session, fetch });
    const items = await c.getContinue();
    expect(items).toHaveLength(1);
    expect(items[0].seriesId).toBe("s1");
  });

  it("GET /trending tolerates an { items } envelope", async () => {
    const { fetch } = jsonFetch({ items: [{ seriesId: "s2", title: "U", poster: null, genre: "Crime" }] });
    const c = createCatalogClient({ baseUrl: "http://x", session, fetch });
    const items = await c.getTrending();
    expect(items[0].genre).toBe("Crime");
  });

  it("GET /series/:id/detail encodes the id and returns merchandising", async () => {
    const { fetch, calls } = jsonFetch({
      hero: null,
      genre: "Thriller",
      format: "vertical",
      episodeCount: 6,
      endingsCount: 3,
      a11y: { cc: true, ad: true, sign: false, langs: 12 },
      episodes: [{ id: "e1", number: 1, coinCost: 0, locked: false }],
    });
    const c = createCatalogClient({ baseUrl: "http://x", session, fetch });
    const d = await c.getSeriesDetail("ab cd");
    expect(calls[0][0]).toBe("http://x/series/ab%20cd/detail");
    expect(d.endingsCount).toBe(3);
    expect(d.a11y.langs).toBe(12);
  });

  it("GET /search encodes q and defaults missing groups to empty arrays", async () => {
    const { fetch, calls } = jsonFetch({ shows: [{ seriesId: "s", title: "S", poster: null, genre: null }] });
    const c = createCatalogClient({ baseUrl: "http://x", session, fetch });
    const r = await c.search("a b");
    expect(calls[0][0]).toBe("http://x/search?q=a%20b");
    expect(r.shows).toHaveLength(1);
    expect(r.characters).toEqual([]);
    expect(r.channels).toEqual([]);
  });
});
