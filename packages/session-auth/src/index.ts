// Real session verification for the axessplayer services: the bearer is a Supabase access token, checked by
// asking Supabase Auth who it belongs to (GET /auth/v1/user). Chosen over local HS256 verification so the
// project's JWT signing secret never has to leave Supabase (it would let anyone forge tokens for the whole
// project, Zone 1 included).
//
// FAIL CLOSED. Any timeout, network error, non-200, or malformed answer means "not authenticated". A slow or
// down Supabase must degrade to 401s, never to letting a request through.
//
// Positive results are cached per token for at most `cacheTtlMs` (default 60s) and never past the token's own
// exp, so a revoked or expired session stops working within a minute. Failures are never cached. The cache
// key is a SHA-256 of the token, so raw tokens are not held in memory longer than a request. No em dashes.

import { createHash } from "node:crypto";

export interface SessionIdentity {
  userId: string;
}

// Same shape as every service's SessionVerifier, so it drops into their Verifiers unchanged.
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

// The Supabase Auth subject behind a token (auth.users.id + email). Identity's /auth/verify links it to an
// Axessplayer profile; every other service maps it to that profile's users.id.
export interface AuthUser {
  authId: string;
  email: string | null;
}

// Maps a Supabase auth user id to the service-level user id (users.id, linked via users.auth_id). Returns
// null when the viewer has no Axessplayer profile yet; they must call identity /auth/verify first.
export type UserIdResolver = (authId: string) => Promise<string | null>;

// A pg-shaped query function, so this package needs no pg dependency.
export type Query = (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

// users.auth_id -> users.id through the service's own pool (search_path decides the schema, as for every
// other query the services run).
export function pgUserIdResolver(query: Query): UserIdResolver {
  return async (authId) => {
    const { rows } = await query("select id from users where auth_id = $1 limit 1", [authId]);
    const id = rows[0]?.id;
    return typeof id === "string" ? id : null;
  };
}

export interface SupabaseSessionVerifierOptions {
  supabaseUrl: string;
  anonKey: string;
  // Defaults to the identity mapping (the auth id IS the user id); services pass pgUserIdResolver.
  resolveUserId?: UserIdResolver;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxCacheEntries?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads exp (seconds) from a JWT payload without trusting anything else in it. Only used to cap the cache.
function tokenExpMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Shared core: asks Supabase who owns the token, fail closed, with the short positive cache.
function supabaseAuthCore(opts: SupabaseSessionVerifierOptions) {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  if (!base || !opts.anonKey) throw new Error("supabase session verification: supabaseUrl and anonKey are required");
  const ttl = opts.cacheTtlMs ?? 60_000;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const maxEntries = opts.maxCacheEntries ?? 10_000;
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { value: unknown; until: number }>();

  async function authUser(token: string | null): Promise<AuthUser | null> {
    if (!token || token === opts.anonKey) return null;
    try {
      const res = await doFetch(`${base}/auth/v1/user`, {
        headers: { apikey: opts.anonKey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) {
        await res.body?.cancel();
        return null;
      }
      const body = (await res.json()) as { id?: unknown; email?: unknown };
      if (typeof body.id !== "string" || !UUID_RE.test(body.id)) return null;
      return { authId: body.id, email: typeof body.email === "string" ? body.email : null };
    } catch {
      return null; // timeout, network error, bad JSON: fail closed
    }
  }

  // Caches only non-null results, never past the token's exp.
  async function cached<T>(namespace: string, token: string | null, compute: () => Promise<T | null>): Promise<T | null> {
    if (!token) return null;
    const key = namespace + ":" + createHash("sha256").update(token).digest("hex");
    const hit = cache.get(key);
    if (hit) {
      if (hit.until > now()) return hit.value as T;
      cache.delete(key);
    }
    const value = await compute();
    if (value === null) return null;
    const until = Math.min(now() + ttl, tokenExpMs(token) ?? Number.POSITIVE_INFINITY);
    if (until > now()) {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
      cache.set(key, { value, until });
    }
    return value;
  }

  return { authUser, cached };
}

export function supabaseSessionVerifier(opts: SupabaseSessionVerifierOptions): SessionVerifier {
  const core = supabaseAuthCore(opts);
  const resolve = opts.resolveUserId ?? (async (authId: string) => authId);
  return {
    verifySession: (token) =>
      core.cached<SessionIdentity>("session", token, async () => {
        const user = await core.authUser(token);
        if (!user) return null;
        try {
          const userId = await resolve(user.authId);
          return userId ? { userId } : null;
        } catch {
          return null; // a failing profile lookup is also unauthenticated
        }
      }),
  };
}

// For identity's /auth/verify: the verified Supabase subject itself (no profile mapping).
export function supabaseAuthUserVerifier(opts: SupabaseSessionVerifierOptions): {
  verifyAccessToken(token: string | null): Promise<AuthUser | null>;
} {
  const core = supabaseAuthCore(opts);
  return { verifyAccessToken: (token) => core.cached<AuthUser>("auth", token, () => core.authUser(token)) };
}

// Picks the session verifier for a service. Real verification whenever SUPABASE_URL and SUPABASE_ANON_KEY are
// set, in every NODE_ENV. Without them: the caller's test verifier outside production, and a hard stop in
// production so a misconfigured deploy cannot silently accept unsigned test tokens.
export interface AuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NODE_ENV?: string;
}

export function selectSessionVerifier(
  env: AuthEnv,
  testVerifier: () => SessionVerifier,
  serviceName: string,
  resolveUserId?: UserIdResolver,
): SessionVerifier {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    return supabaseSessionVerifier({
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      ...(resolveUserId ? { resolveUserId } : {}),
    });
  }
  if (env.NODE_ENV === "production") {
    throw new Error(`${serviceName}: SUPABASE_URL and SUPABASE_ANON_KEY are required in production (real session verification)`);
  }
  return testVerifier();
}
