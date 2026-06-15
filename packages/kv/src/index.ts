// Public surface of @axessplayer/kv: the KVStore interface, the in-memory default, the Redis adapter, and
// a config-driven factory. The decision serving cache (and any hot read path) can adopt this later to
// hold pre-warmed, fan-out-capped data without rewiring: swap the factory env, not the call sites.
//
// Selection is by env. KV_URL (or REDIS_URL) present => Redis adapter; absent => in-memory default. The
// factory NEVER reads secret values into code or logs; it only branches on whether the URL is present and
// passes it straight to the driver. No em dashes.

import { InMemoryKV } from "./memory.js";
import { RedisKV, connectRedis } from "./redis.js";
import { type KVStore, type RedisLikeClient } from "./types.js";

export { type KVStore, type RedisLikeClient } from "./types.js";
export { InMemoryKV } from "./memory.js";
export { RedisKV, connectRedis } from "./redis.js";

export interface KVConfig {
  // Connection URL for the Redis/KV backend. When undefined or empty, the in-memory store is used.
  url?: string;
  // Pre-built client (or fake). When given, it is used directly and `url` is ignored. For tests and for
  // production wiring that owns its own connection lifecycle.
  client?: RedisLikeClient;
}

// Read the KV connection URL from the environment without ever materializing a secret in code. Accepts
// KV_URL first, then REDIS_URL as an alias. Returns undefined when neither is set.
export function kvUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.KV_URL ?? env.REDIS_URL;
  return url && url.length > 0 ? url : undefined;
}

// Build a KVStore from config. With an injected client => Redis adapter over it. With a url => connect a
// real Redis client and wrap it. With neither => the in-memory default. This is the one place call sites
// depend on; flipping environments is a config change, not a code change. No em dashes.
export async function createKVStore(config: KVConfig = {}): Promise<KVStore> {
  if (config.client) {
    return new RedisKV(config.client);
  }
  if (config.url && config.url.length > 0) {
    const client = await connectRedis(config.url);
    return new RedisKV(client);
  }
  return new InMemoryKV();
}

// Convenience: build the store straight from the environment. Used by services that just want "the KV the
// deployment configured" with no further decisions.
export async function createKVStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<KVStore> {
  return createKVStore({ url: kvUrlFromEnv(env) });
}
