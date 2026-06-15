// Runtime configuration for the consumer app's network layer. The base urls are CONFIGURABLE (one per
// service, or one gateway origin behind which all four sit) so the same build points at the Prism
// mocks, a local test server, staging, or production by config alone. Session identity is an INJECTED
// bearer (the Supabase session token in the real app); the app never embeds a user id anywhere.
//
// F1 (economy 0.3.2): the acting user is ALWAYS the session subject carried by the bearer. The client
// NEVER puts a user_id in a request body. This file deliberately has no user-id field to misuse. No em
// dashes.

export interface ServiceBaseUrls {
  // GET /series/{id}/graph and the content graph reads.
  content: string;
  // POST /decide (the player SDK transport). Configured here for one source of truth.
  decision: string;
  // GET /manifest/{variant_id}.m3u8 (the player SDK transport).
  manifest: string;
  // GET /wallet, POST /spend.
  economy: string;
}

// How the app obtains the current session bearer. Async so the host can refresh an expired token before
// a call. Returns null when signed out (the client then surfaces a 401-style auth-required state).
export type BearerProvider = () => Promise<string | null> | string | null;

export interface AppConfig {
  baseUrls: ServiceBaseUrls;
  getBearer: BearerProvider;
  // Injectable for tests; defaults to the global fetch (React Native and Node 20+ both provide one).
  fetch?: typeof globalThis.fetch;
}

// Convenience: point every service at one gateway origin (the common Prism-mock / single-gateway case).
export function singleOrigin(
  origin: string,
  getBearer: BearerProvider,
  fetchImpl?: typeof globalThis.fetch
): AppConfig {
  const o = trimSlash(origin);
  return {
    baseUrls: { content: o, decision: o, manifest: o, economy: o },
    getBearer,
    fetch: fetchImpl,
  };
}

export function trimSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
