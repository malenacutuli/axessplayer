// Route tests for the library HTTP adapter, exercising the real Hono app over the pure handlers with the
// FakeLibraryDb and the TEST session verifier. These prove the transport and the trust boundary, not the
// handler logic (handlers.test.ts covers that):
//
//   - every endpoint is 401 without a valid session token, before any DB access.
//   - identity is taken from the session token, never the body or path: two distinct token subjects keep
//     fully separate libraries even when they target the same seriesId.
//   - idempotent re-POST over the wire returns 201 with the same row.
//   - DELETE removes only the token subject's row.
//
// Auth uses the TEST verifier: token "session:<uuid>" resolves to that uuid. Real JWT/JWKS verification is
// a flagged stub behind SessionVerifier. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLibraryApp } from "../src/http/app.js";
import { testVerifiers } from "../src/http/auth.js";
import { FakeLibraryDb } from "./fakeDb.js";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const SERIES = "11111111-1111-1111-1111-111111111111";
const bearer = (uuid: string) => `Bearer session:${uuid}`;

function app() {
  return createLibraryApp({ db: new FakeLibraryDb(), verifiers: testVerifiers() });
}

test("GET /saved without a token is 401, before any DB access", async () => {
  const res = await app().request("/saved");
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, "unauthorized");
});

test("a non-session bearer and a non-uuid subject are both 401", async () => {
  const a = app();
  assert.equal((await a.request("/saved", { headers: { authorization: "Bearer not-a-session" } })).status, 401);
  assert.equal((await a.request("/saved", { headers: { authorization: bearer("not-a-uuid") } })).status, 401);
});

test("POST /saved keys on the token subject, not a body user_id; libraries stay isolated", async () => {
  const a = app();
  // A saves SERIES, smuggling B's id into the body. The body id must be ignored.
  const post = await a.request("/saved", {
    method: "POST",
    headers: { authorization: bearer(A), "content-type": "application/json" },
    body: JSON.stringify({ seriesId: SERIES, user_id: B }),
  });
  assert.equal(post.status, 201);

  // A sees the row.
  const aList = await a.request("/saved", { headers: { authorization: bearer(A) } });
  assert.equal(((await aList.json()) as { saved: unknown[] }).saved.length, 1);

  // B sees nothing: the smuggled body user_id did not write into B's library.
  const bList = await a.request("/saved", { headers: { authorization: bearer(B) } });
  assert.equal(((await bList.json()) as { saved: unknown[] }).saved.length, 0);
});

test("POST /saved is idempotent over the wire (re-POST returns 201, single row)", async () => {
  const a = app();
  const headers = { authorization: bearer(A), "content-type": "application/json" };
  const first = await a.request("/saved", { method: "POST", headers, body: JSON.stringify({ seriesId: SERIES }) });
  const again = await a.request("/saved", { method: "POST", headers, body: JSON.stringify({ seriesId: SERIES }) });
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  const list = await a.request("/saved", { headers: { authorization: bearer(A) } });
  assert.equal(((await list.json()) as { saved: unknown[] }).saved.length, 1);
});

test("DELETE /saved/:seriesId removes only the token subject's row", async () => {
  const a = app();
  // both A and B save the same series
  for (const u of [A, B]) {
    await a.request("/saved", {
      method: "POST",
      headers: { authorization: bearer(u), "content-type": "application/json" },
      body: JSON.stringify({ seriesId: SERIES }),
    });
  }
  // B deletes; A's row survives
  const del = await a.request(`/saved/${SERIES}`, { method: "DELETE", headers: { authorization: bearer(B) } });
  assert.equal(del.status, 204);
  const aList = await a.request("/saved", { headers: { authorization: bearer(A) } });
  assert.equal(((await aList.json()) as { saved: unknown[] }).saved.length, 1);
  const bList = await a.request("/saved", { headers: { authorization: bearer(B) } });
  assert.equal(((await bList.json()) as { saved: unknown[] }).saved.length, 0);
});

test("PATCH /downloads/:seriesId advances the owner's status and 404s a foreign row", async () => {
  const a = app();
  await a.request("/downloads", {
    method: "POST",
    headers: { authorization: bearer(A), "content-type": "application/json" },
    body: JSON.stringify({ seriesId: SERIES, episodeIds: ["e1"] }),
  });
  const ok = await a.request(`/downloads/${SERIES}`, {
    method: "PATCH",
    headers: { authorization: bearer(A), "content-type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  assert.equal(ok.status, 200);
  // B has no such download row -> 404
  const foreign = await a.request(`/downloads/${SERIES}`, {
    method: "PATCH",
    headers: { authorization: bearer(B), "content-type": "application/json" },
    body: JSON.stringify({ status: "removed" }),
  });
  assert.equal(foreign.status, 404);
});

test("all write endpoints reject a missing token with 401 before mutating", async () => {
  const a = app();
  const calls: [string, string, unknown][] = [
    ["POST", "/saved", { seriesId: SERIES }],
    ["POST", "/favorites", { targetType: "show", targetId: SERIES }],
    ["POST", "/downloads", { seriesId: SERIES, episodeIds: ["e1"] }],
    ["POST", "/channel-follows", { channelId: "ch-1" }],
  ];
  for (const [method, path, body] of calls) {
    const res = await a.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401, `${method} ${path} must be 401 without a token`);
  }
});
