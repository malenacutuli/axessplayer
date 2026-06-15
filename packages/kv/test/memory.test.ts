// Tests for the in-memory KVStore, including lazy TTL expiry via an injectable clock. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryKV } from "../src/index.js";

test("set then get returns the value", async () => {
  const kv = new InMemoryKV();
  await kv.set("a", "1");
  assert.equal(await kv.get("a"), "1");
});

test("get on a missing key returns null", async () => {
  const kv = new InMemoryKV();
  assert.equal(await kv.get("nope"), null);
});

test("has reflects presence and del removes", async () => {
  const kv = new InMemoryKV();
  await kv.set("k", "v");
  assert.equal(await kv.has("k"), true);
  await kv.del("k");
  assert.equal(await kv.has("k"), false);
  assert.equal(await kv.get("k"), null);
});

test("del on a missing key is idempotent", async () => {
  const kv = new InMemoryKV();
  await kv.del("ghost");
  assert.equal(await kv.has("ghost"), false);
});

test("ttl expires the key once the clock passes the expiry", async () => {
  let now = 1000;
  const kv = new InMemoryKV(() => now);
  await kv.set("t", "v", 5); // expires at 1000 + 5000
  now = 5999;
  assert.equal(await kv.get("t"), "v", "still live just before expiry");
  now = 6000;
  assert.equal(await kv.get("t"), null, "miss at expiry");
  assert.equal(await kv.has("t"), false);
});

test("ttl of zero or undefined persists the key", async () => {
  let now = 0;
  const kv = new InMemoryKV(() => now);
  await kv.set("p", "v");
  await kv.set("q", "v", 0);
  now = 10_000_000;
  assert.equal(await kv.get("p"), "v");
  assert.equal(await kv.get("q"), "v");
});

test("close clears the store", async () => {
  const kv = new InMemoryKV();
  await kv.set("k", "v");
  await kv.close();
  assert.equal(await kv.get("k"), null);
});
