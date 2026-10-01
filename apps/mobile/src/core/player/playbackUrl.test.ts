import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TTL_MS, expiryFromUrl, PlaybackUrlCache, resolvePlaybackUrl, shouldRetryPlayback } from "./playbackUrl";

test("expiry from exp query param (seconds) or default ttl", () => {
  const t = 1_790_000_000_000;
  assert.equal(expiryFromUrl("https://cdn/x.m3u8?exp=1790000600&sig=a", t), 1_790_000_600_000);
  assert.equal(expiryFromUrl("https://cdn/x.m3u8", t), t + DEFAULT_TTL_MS);
  assert.equal(expiryFromUrl("https://cdn/x.m3u8?exp=1000000000", t), t + DEFAULT_TTL_MS);
});

test("cache serves fresh urls and refetches near expiry", async () => {
  let now = 1_000_000;
  const cache = new PlaybackUrlCache(() => now);
  let fetches = 0;
  const fetchUrl = async () => {
    fetches++;
    return `https://cdn/v.m3u8?n=${fetches}`;
  };
  assert.equal(await resolvePlaybackUrl(cache, "v", fetchUrl), "https://cdn/v.m3u8?n=1");
  assert.equal(await resolvePlaybackUrl(cache, "v", fetchUrl), "https://cdn/v.m3u8?n=1");
  now += DEFAULT_TTL_MS - 10_000;
  assert.equal(await resolvePlaybackUrl(cache, "v", fetchUrl), "https://cdn/v.m3u8?n=2");
});

test("forceRefresh after a CDN 403 bypasses the cache; retries are bounded", async () => {
  const cache = new PlaybackUrlCache(() => 0);
  let n = 0;
  const fetchUrl = async () => `u${++n}`;
  await resolvePlaybackUrl(cache, "v", fetchUrl);
  assert.equal(await resolvePlaybackUrl(cache, "v", fetchUrl, true), "u2");
  assert.equal(shouldRetryPlayback(0), true);
  assert.equal(shouldRetryPlayback(2), false);
});

test("a failed fetch is not cached", async () => {
  const cache = new PlaybackUrlCache(() => 0);
  assert.equal(await resolvePlaybackUrl(cache, "v", async () => null), null);
  assert.equal(cache.get("v"), null);
});

test("expiry from a Cloudflare Stream signed token (JWT in the path)", () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ sub: "uid", exp: 1790003600 })}.sig`;
  const url = `https://customer-abc.cloudflarestream.com/${token}/manifest/video.m3u8`;
  assert.equal(expiryFromUrl(url, 1_790_000_000_000), 1_790_003_600_000);
});
