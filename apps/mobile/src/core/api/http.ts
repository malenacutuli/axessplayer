// The one fetch wrapper every v2 client uses. Two rules live here so no screen can get them wrong:
//  1. Auth: "Authorization: Bearer <supabase access token>" is attached ONLY when a token exists. A guest
//     request carries no Authorization header at all (not an empty one).
//  2. Degrade, never throw: every call resolves to an ApiResult. A 404 from an endpoint that is not
//     deployed yet becomes { ok: false, reason: "not_found" } and the screen shows a calm empty state.
// No em dashes.

export type TokenProvider = () => Promise<string | null> | string | null;

export type FailureReason =
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "server"
  | "network"
  | "bad_response";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: FailureReason; status?: number };

export interface HttpOptions {
  getAccessToken: TokenProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface RequestSpec {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function reasonForStatus(status: number): FailureReason {
  if (status === 404 || status === 405 || status === 501) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "server";
}

export async function buildHeaders(
  getAccessToken: TokenProvider,
  extra: Record<string, string> = {},
  hasBody = false
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { accept: "application/json", ...extra };
  if (hasBody) headers["content-type"] = "application/json";
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export function createHttp(opts: HttpOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;

  async function request<T>(spec: RequestSpec, parse: (json: unknown) => T | null): Promise<ApiResult<T>> {
    const hasBody = spec.body !== undefined;
    const headers = await buildHeaders(opts.getAccessToken, spec.headers, hasBody);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await doFetch(spec.url, {
        method: spec.method,
        headers,
        body: hasBody ? JSON.stringify(spec.body) : undefined,
        signal: controller?.signal,
      });
    } catch {
      return { ok: false, reason: "network" };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status), status: res.status };
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    const data = parse(json);
    if (data === null) return { ok: false, reason: "bad_response", status: res.status };
    return { ok: true, data };
  }

  return { request };
}

export type Http = ReturnType<typeof createHttp>;
