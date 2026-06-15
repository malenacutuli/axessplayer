// The shared fetch helper. Every service call goes through here so the F1 rule is enforced in ONE
// place: identity is the session bearer token, never a field in the JSON body. A dev-only guard
// throws if any caller ever tries to put user_id in a body, so the rule fails loud in tests rather
// than leaking to the wire. No em dashes.

import { authHeader, type SessionProvider } from "./session.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`api error ${status}`);
    this.name = "ApiError";
  }
}

// F1 guard: reject any body that carries a user id. The session subject is the only identity.
function assertNoUserId(body: unknown): void {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of Object.keys(body as Record<string, unknown>)) {
      const k = key.toLowerCase();
      if (k === "user_id" || k === "userid" || k === "uid") {
        throw new Error(`F1 violation: a request body must never carry ${key}; identity is the session subject`);
      }
    }
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  // JSON body for POST. Validated against the F1 rule before serialization.
  body?: unknown;
  // Injectable for tests; defaults to the global fetch.
  fetch?: typeof globalThis.fetch;
}

// Performs an authenticated JSON request. Returns parsed JSON on 2xx, throws ApiError otherwise so
// callers can branch on status (for example 402 -> paywall, 401 -> sign in).
export async function apiFetch<T>(
  baseUrl: string,
  path: string,
  session: SessionProvider,
  opts: RequestOptions = {},
): Promise<T> {
  // Bind the global fetch to its receiver. A bare `globalThis.fetch` reference is detached, and the
  // browser's fetch is unforgeable: calling it with this !== window throws "Illegal invocation". Tests
  // inject opts.fetch so they never hit this branch, which is why the bug only surfaced in the browser.
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { ...(await authHeader(session)) };

  let serializedBody: string | undefined;
  if (opts.body !== undefined) {
    assertNoUserId(opts.body);
    headers["content-type"] = "application/json";
    serializedBody = JSON.stringify(opts.body);
  }

  const res = await doFetch(`${trimSlash(baseUrl)}${path}`, {
    method,
    headers,
    body: serializedBody,
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function trimSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
