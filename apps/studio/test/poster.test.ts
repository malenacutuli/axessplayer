// Unit tests for the poster generation seam: it refuses to fake a vendor when unconfigured, parses the common
// edge-function response shapes, and records synthetic C2PA provenance. No em dashes.
import { describe, it, expect, vi } from "vitest";
import {
  generatePoster,
  parseCandidates,
  posterProvenance,
  isPosterConfigured,
  PosterNotConfiguredError,
  POSTER_STYLES,
} from "../src/api/poster.js";

describe("poster seam", () => {
  it("throws PosterNotConfiguredError when no endpoint is configured", async () => {
    await expect(
      generatePoster({ title: "The Last Signal", style: POSTER_STYLES[0] }, { config: {} }),
    ).rejects.toBeInstanceOf(PosterNotConfiguredError);
    expect(isPosterConfigured({})).toBe(false);
    expect(isPosterConfigured({ endpoint: "https://x" })).toBe(true);
  });

  it("parses candidate urls from the common edge-function shapes", () => {
    expect(parseCandidates({ data: [{ url: "https://a/1.png" }, { url: "https://a/2.png" }] })).toHaveLength(2);
    expect(parseCandidates({ images: ["https://b/1.png"] })).toEqual([{ url: "https://b/1.png" }]);
    expect(parseCandidates({ url: "https://c/1.png" })).toEqual([{ url: "https://c/1.png" }]);
    expect(parseCandidates({ nope: 1 })).toEqual([]);
  });

  it("calls the configured endpoint and returns candidates", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ url: "https://poster/1.png" }] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const out = await generatePoster(
      { title: "The Last Signal", logline: "a thriller", style: POSTER_STYLES[1] },
      { config: { endpoint: "https://axessible/fn", key: "anon" }, fetch: fetchImpl },
    );
    expect(out).toEqual([{ url: "https://poster/1.png" }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("records synthetic C2PA provenance for the Article 50 posture", () => {
    expect(posterProvenance(POSTER_STYLES[0])).toMatchObject({ c2pa: true, synthetic: true });
  });
});
