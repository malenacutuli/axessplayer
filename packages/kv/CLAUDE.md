# @axessplayer/kv

Owned by W11 (infra). A config-driven KV/Redis serving-cache adapter the decision serving path (and any
hot read path) can adopt later for pre-warmed, branch-fan-out-capped data, without rewiring call sites.

## Shape
- `KVStore`: string in, string out, with seconds TTL (`get`, `set`, `del`, `has`, `close`). Callers own
  serialization, so the cache stays a dumb key/value store.
- `InMemoryKV`: the default. Process-local, lazy TTL via an injectable clock. Correctness-equivalent
  stand-in, not a scale one.
- `RedisKV`: binds to a structural `RedisLikeClient` (node-redis or ioredis both satisfy it), so this
  package carries no hard Redis dependency. `connectRedis(url)` lazily imports `redis` at runtime and
  throws a clear error if the driver is absent.
- `createKVStore` / `createKVStoreFromEnv`: pick the backend by env. `KV_URL` (or `REDIS_URL`) present =>
  Redis; absent => in-memory. Flip environments by config, not code.

## Rules
- Never read a secret value into code or logs. The factory only branches on presence of the URL.
- This package does NOT edit `services/decision`. Adoption there is a later, separate change.

## Test
`pnpm --filter @axessplayer/kv test` (node:test + tsx; fake Redis client, no network).
