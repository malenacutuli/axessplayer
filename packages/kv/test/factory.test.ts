// Tests for the config-driven factory and the Redis adapter over an injected fake client. No real Redis
// is contacted: the fake implements RedisLikeClient so the adapter logic (EX on ttl, exists, quit) is
// exercised deterministically. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createKVStore,
  createKVStoreFromEnv,
  kvUrlFromEnv,
  InMemoryKV,
  RedisKV,
  type RedisLikeClient,
} from "../src/index.js";

// Minimal in-memory stand-in shaped like node-redis. Records the last EX seen so the TTL path is testable.
class FakeRedis implements RedisLikeClient {
  map = new Map<string, string>();
  lastEx: number | undefined;
  quitCalled = false;
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string, options?: { EX?: number }) {
    this.lastEx = options?.EX;
    this.map.set(key, value);
    return "OK";
  }
  async del(key: string) {
    return this.map.delete(key) ? 1 : 0;
  }
  async exists(key: string) {
    return this.map.has(key) ? 1 : 0;
  }
  async quit() {
    this.quitCalled = true;
    return "OK";
  }
}

test("factory with no url returns the in-memory store", async () => {
  const kv = await createKVStore();
  assert.ok(kv instanceof InMemoryKV);
});

test("factory with an injected client returns the Redis adapter", async () => {
  const fake = new FakeRedis();
  const kv = await createKVStore({ client: fake });
  assert.ok(kv instanceof RedisKV);
});

test("redis adapter passes ttl through as EX and round-trips values", async () => {
  const fake = new FakeRedis();
  const kv = new RedisKV(fake);
  await kv.set("k", "v", 30);
  assert.equal(fake.lastEx, 30);
  assert.equal(await kv.get("k"), "v");
  assert.equal(await kv.has("k"), true);
  await kv.del("k");
  assert.equal(await kv.has("k"), false);
});

test("redis adapter omits EX when no ttl is given", async () => {
  const fake = new FakeRedis();
  const kv = new RedisKV(fake);
  await kv.set("k", "v");
  assert.equal(fake.lastEx, undefined);
});

test("redis adapter close calls quit", async () => {
  const fake = new FakeRedis();
  const kv = new RedisKV(fake);
  await kv.close();
  assert.equal(fake.quitCalled, true);
});

test("kvUrlFromEnv prefers KV_URL, falls back to REDIS_URL, else undefined", () => {
  assert.equal(kvUrlFromEnv({ KV_URL: "redis://a" } as NodeJS.ProcessEnv), "redis://a");
  assert.equal(kvUrlFromEnv({ REDIS_URL: "redis://b" } as NodeJS.ProcessEnv), "redis://b");
  assert.equal(
    kvUrlFromEnv({ KV_URL: "redis://a", REDIS_URL: "redis://b" } as NodeJS.ProcessEnv),
    "redis://a",
  );
  assert.equal(kvUrlFromEnv({} as NodeJS.ProcessEnv), undefined);
  assert.equal(kvUrlFromEnv({ KV_URL: "" } as NodeJS.ProcessEnv), undefined);
});

test("createKVStoreFromEnv with empty env returns the in-memory store", async () => {
  const kv = await createKVStoreFromEnv({} as NodeJS.ProcessEnv);
  assert.ok(kv instanceof InMemoryKV);
});
