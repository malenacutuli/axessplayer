// Recording fetch fake shared by the core tests. Not shipped in the app bundle (only *.test.ts import
// it). No em dashes.

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function recordingFetch(respond: (url: string, init: RequestInit) => { status: number; body?: unknown } | "throw") {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = { ...(init.headers as Record<string, string>) };
    calls.push({
      url,
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const r = respond(url, init);
    if (r === "throw") throw new TypeError("network down");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}
