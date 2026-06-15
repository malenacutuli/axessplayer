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
});
