// In-memory KVStore. The default adapter: used in tests, local runs, and any environment where KV_URL is
// not configured. TTL is enforced lazily on read (a key past its expiry resolves as a miss and is
// evicted), which mirrors how Redis reports expired keys without a background sweep. Process-local only,
// so it does NOT share state across instances; it is a correctness-equivalent stand-in, not a scale one.
// No em dashes.

import { type KVStore } from "./types.js";

interface Entry {
  value: string;
  // Absolute expiry in epoch ms, or null for no expiry.
  expiresAt: number | null;
}

export class InMemoryKV implements KVStore {
  private store = new Map<string, Entry>();
  // Injectable clock so tests can assert TTL without real waiting.
  constructor(private now: () => number = () => Date.now()) {}

  private live(key: string): Entry | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.live(key) !== null;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
