// Unit test for the shared fetch helper. It attaches the session bearer, refuses any body that
// carries a user id (F1), and surfaces non-2xx as ApiError. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { apiFetch, ApiError } from "./http.js";
import { staticSession } from "./session.js";

const session = staticSession("tok");

function okFetch(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof globalThis.fetch;
}

describe("apiFetch", () => {
  it("attaches the session bearer header", async () => {
    const f = okFetch();
    await apiFetch("http://x", "/wallet", session, { fetch: f });
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
  });

  it("refuses a body carrying user_id (F1)", async () => {
    await expect(
      apiFetch("http://x", "/spend", session, { method: "POST", body: { user_id: "nope", scope: "episode" }, fetch: okFetch() }),
    ).rejects.toThrow(/F1 violation/);
  });

  it("refuses common user id aliases too", async () => {
    await expect(
      apiFetch("http://x", "/spend", session, { method: "POST", body: { userId: "nope" }, fetch: okFetch() }),
    ).rejects.toThrow(/F1 violation/);
  });

  it("throws ApiError on a non-2xx with the parsed body", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "insufficient_funds", options: ["buy"] }), { status: 402, headers: { "content-type": "application/json" } })) as unknown as typeof globalThis.fetch;
    await expect(apiFetch("http://x", "/spend", session, { method: "POST", body: { scope: "episode", scope_id: "e", client_txn_id: "t" }, fetch: f }))
      .rejects.toMatchObject({ status: 402 } satisfies Partial<ApiError>);
  });

  // Regression for the browser-only "Failed to execute 'fetch' on 'Window': Illegal invocation".
  // When no fetch is injected, apiFetch falls back to the global fetch. The browser's fetch is
  // unforgeable: it throws unless its receiver is the global object. node/jsdom do NOT enforce this,
  // so we install a fetch that emulates the browser rule, then assert the un-injected call still works
  // (i.e. apiFetch binds the global fetch to its receiver rather than passing a detached reference).
  it("calls the global fetch with the correct receiver when none is injected", async () => {
    const original = globalThis.fetch;
    let receiverWasGlobal = false;
    const unforgeable = function (this: unknown): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      receiverWasGlobal = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    globalThis.fetch = unforgeable as unknown as typeof globalThis.fetch;
    try {
      // No `fetch` in opts -> the fallback path the browser actually exercises.
      const out = await apiFetch<{ ok: boolean }>("http://x", "/series/s/graph", session);
      expect(out).toEqual({ ok: true });
      expect(receiverWasGlobal).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
