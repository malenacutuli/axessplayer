// Typed client for services/identity (the 20-V0 auth + profile backend). Mirrors services/identity HTTP
// adapter exactly (see services/identity/src/http/app.ts):
//
//   POST /auth/verify              (Supabase access token bearer) -> { user, profile_complete }
//   GET  /profile/username-available?u=NAME                       -> { available, reason? }
//   POST /profile                  (session bearer)               -> { user, profile_complete }
//   GET  /me                       (session bearer)               -> { user, profile_complete }
//
// F1 trust boundary: identity is the bearer token, never a body field. The body NEVER carries a user_id.
// Acceptance is e2e-PENDING the hosted auth tables; every call degrades to a typed error the UI renders as
// a graceful "backend not ready" state rather than crashing. No em dashes.

export interface IdentityUser {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  tier: string | null;
}

export interface VerifyResult {
  user: IdentityUser;
  profile_complete: boolean;
}

export type UsernameReason = "empty" | "too_short" | "too_long" | "invalid_chars";

export interface UsernameAvailability {
  available: boolean;
  reason?: UsernameReason;
}

export interface ProfilePick {
  channelId: string;
}

export interface CreateProfileInput {
  username: string;
  avatar_url?: string | null;
  picks?: ProfilePick[];
  series_id?: string;
}

export class IdentityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `identity error ${status}: ${code}`);
    this.name = "IdentityError";
  }
}

export interface IdentityClient {
  // Exchange a Supabase access token for an Axessplayer profile, linking/creating by auth id.
  verify(accessToken: string): Promise<VerifyResult>;
  // Live, case-insensitive availability. Never throws on an ill-shaped name; reports a reason instead.
  usernameAvailable(username: string): Promise<UsernameAvailability>;
  // Create/update the session subject's profile. Bearer is the Supabase access token.
  createProfile(accessToken: string, input: CreateProfileInput): Promise<VerifyResult>;
  // The session subject's profile.
  me(accessToken: string): Promise<VerifyResult>;
}

export interface IdentityClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

function trimSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

export function createIdentityClient(opts: IdentityClientOptions): IdentityClient {
  const base = trimSlash(opts.baseUrl);
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(
    path: string,
    init: { method: "GET" | "POST"; token?: string; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method: init.method, headers, body });
    } catch (err) {
      // Network/backend-not-ready: surface as a typed error the UI renders gracefully.
      throw new IdentityError(0, "backend_unreachable", err instanceof Error ? err.message : undefined);
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const code =
        parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `http_${res.status}`;
      throw new IdentityError(res.status, code);
    }
    return parsed as T;
  }

  return {
    verify(accessToken) {
      return call<VerifyResult>("/auth/verify", { method: "POST", token: accessToken });
    },
    usernameAvailable(username) {
      const q = encodeURIComponent(username);
      return call<UsernameAvailability>(`/profile/username-available?u=${q}`, { method: "GET" });
    },
    createProfile(accessToken, input) {
      // F1: no user_id in the body; the session subject is the bearer.
      const body: Record<string, unknown> = { username: input.username };
      if (input.avatar_url != null) body.avatar_url = input.avatar_url;
      if (input.picks) body.picks = input.picks;
      if (input.series_id) body.series_id = input.series_id;
      return call<VerifyResult>("/profile", { method: "POST", token: accessToken, body });
    },
    me(accessToken) {
      return call<VerifyResult>("/me", { method: "GET", token: accessToken });
    },
  };
}
