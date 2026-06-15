// Unit tests for the content fetch client: F1 (never send user_id), base URL joining, error mapping.
import { describe, it, expect } from "vitest";
import { ContentClient, ContentApiError, stripUserId } from "../src/api/client.js";
import { createFakeContentServer } from "./fakeContentServer.js";

describe("stripUserId", () => {
  it("removes a user_id key from an object body (F1)", () => {
    expect(stripUserId({ title: "x", user_id: "u1" })).toEqual({ title: "x" });
  });
  it("leaves objects without user_id untouched", () => {
    expect(stripUserId({ title: "x" })).toEqual({ title: "x" });
  });
  it("passes through non-objects", () => {
    expect(stripUserId(null)).toBeNull();
    expect(stripUserId([1, 2])).toEqual([1, 2]);
  });
});

describe("ContentClient F1 guardrail", () => {
  it("never sends user_id even if a caller smuggles one in", async () => {
    const server = createFakeContentServer();
    const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
    // Force a user_id through the typed boundary to prove the client strips it.
    await client.createSeries({ title: "Smuggle", user_id: "attacker" } as never);
    const last = server.lastBodies.at(-1);
    expect(last?.path).toBe("/series");
    expect(last?.body).not.toHaveProperty("user_id");
  });

  it("sends no user_id on a normal create across every endpoint", async () => {
    const server = createFakeContentServer();
    const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
    const s = await client.createSeries({ title: "S" });
    const e = await client.createEpisode({ series_id: s.id, episode_number: 1 });
    const b = await client.createBeat({ series_id: s.id, episode_id: e.id, beat_index: 0, role: "spine" });
    await client.createVariant({ beat_id: b.id, tier: "A_filmed", playback_url: "https://v/1.m3u8" });
    const b2 = await client.createBeat({ series_id: s.id, episode_id: e.id, beat_index: 1, role: "hero" });
    await client.createEdge({ from_beat_id: b.id, to_beat_id: b2.id });
    for (const rec of server.lastBodies) {
      expect(rec.body).not.toHaveProperty("user_id");
    }
  });
});

describe("ContentClient base url and errors", () => {
  it("joins base url with and without a trailing slash", async () => {
    const seen: string[] = [];
    const fetchSpy = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    const c1 = new ContentClient({ baseUrl: "http://h/", fetchImpl: fetchSpy });
    await c1.getSeriesGraph("00000000-0000-4000-8000-000000000001");
    expect(seen[0]).toBe("http://h/series/00000000-0000-4000-8000-000000000001/graph");
  });

  it("maps a 400 to a ContentApiError carrying the api error code", async () => {
    const server = createFakeContentServer();
    const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
    await expect(client.createSeries({ title: "" })).rejects.toMatchObject({
      name: "ContentApiError",
      status: 400,
      apiError: "invalid_title",
    });
  });

  it("maps a 404 graph to a ContentApiError", async () => {
    const server = createFakeContentServer();
    const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
    await expect(client.getSeriesGraph("00000000-0000-4000-8000-0000000000ff")).rejects.toBeInstanceOf(
      ContentApiError,
    );
  });
});
