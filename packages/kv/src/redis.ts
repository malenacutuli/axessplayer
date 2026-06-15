// Redis-backed KVStore. Guarded by env: only constructed when KV_URL (or REDIS_URL) is set. It binds to
// the structural RedisLikeClient, not a concrete driver, so this package carries NO hard dependency on a
// Redis client library. The client is injected (production wiring or a test fake). A connect helper that
// lazily imports `redis` at runtime is provided for production; it throws a clear, actionable error if
// the driver is not installed, so a missing dependency fails loudly at boot, never silently. No em dashes.

import { type KVStore, type RedisLikeClient } from "./types.js";

export class RedisKV implements KVStore {
  constructor(private client: RedisLikeClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, value, { EX: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

// Lazily import the `redis` driver and open a connection. Kept out of the module top-level so the package
// neither imports nor requires `redis` unless someone actually connects. The dynamic import string is
// concatenated so bundlers and the TypeScript checker do not try to resolve the (optional) module at
// build time. Production wiring is expected to `pnpm add redis` in the consuming service. No em dashes.
export async function connectRedis(url: string): Promise<RedisLikeClient> {
  let mod: { createClient: (opts: { url: string }) => RedisLikeClient & { connect: () => Promise<unknown> } };
  try {
    mod = (await import("redis" + "")) as typeof mod;
  } catch {
    throw new Error(
      "KV_URL is set but the 'redis' driver is not installed. Run `pnpm add redis` in the consuming service, " +
        "or unset KV_URL to fall back to the in-memory store.",
    );
  }
  const client = mod.createClient({ url });
  await client.connect();
  return client;
}
