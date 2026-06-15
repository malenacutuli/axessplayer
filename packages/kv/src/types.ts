// The KV serving cache interface. This is the generic key/value contract the decision serving path (and
// any other hot read path) can adopt later to hold pre-warmed, branch-fan-out-capped data at the edge.
// It is deliberately string in, string out: callers own their own serialization (JSON, msgpack) so the
// adapter stays a dumb cache. TTL is seconds, matching Redis EXPIRE semantics. No em dashes.

export interface KVStore {
  // Read a value. Resolves null on a miss or an expired key.
  get(key: string): Promise<string | null>;
  // Write a value. ttlSeconds, when given and positive, sets an expiry; otherwise the key persists.
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  // Remove a key. Idempotent: deleting an absent key is not an error.
  del(key: string): Promise<void>;
  // True if the key exists and has not expired.
  has(key: string): Promise<boolean>;
  // Release any underlying resources (connections). Idempotent. The in-memory store is a no-op.
  close(): Promise<void>;
}

// A minimal Redis-shaped client. Both `redis` (node-redis v4) and `ioredis` satisfy a superset of this,
// so the adapter binds to this structural type instead of a concrete driver. That keeps the package free
// of a hard dependency on a specific Redis client and lets tests inject a fake. No em dashes.
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  // node-redis v4 set options object; the adapter only uses EX (expire seconds).
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
}
