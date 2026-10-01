// Spec for the Supabase session verifier: real users pass, everything else (including a slow or failing
// Supabase) is unauthenticated, and positive answers are cached briefly. No em dashes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { supabaseSessionVerifier, supabaseAuthUserVerifier, selectSessionVerifier, pgUserIdResolver, type SessionVerifier } from "../src/index.js";

const USER = "3f1c2a9e-1111-4222-8333-944455556666";
const jwt = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ sub: USER, exp })).toString("base64url")}.s`;

function fakeAuth(handler: (token: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const token = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    calls.push(token);
    return handler(token);
  }) as typeof fetch;
  return { f, calls };
}

const base = { supabaseUrl: "https://example.supabase.co", anonKey: "anon-key" };

describe("supabaseSessionVerifier", () => {
  it("returns the Supabase user id for a valid session", async () => {
    const { f } = fakeAuth(() => Response.json({ id: USER }));
    const v = supabaseSessionVerifier({ ...base, fetch: f });
    assert.deepEqual(await v.verifySession(jwt(Date.now() / 1000 + 3600)), { userId: USER });
  });

  it("rejects missing tokens and the anon key without calling Supabase", async () => {
    const { f, calls } = fakeAuth(() => Response.json({ id: USER }));
    const v = supabaseSessionVerifier({ ...base, fetch: f });
    assert.equal(await v.verifySession(null), null);
    assert.equal(await v.verifySession(""), null);
    assert.equal(await v.verifySession("anon-key"), null);
    assert.equal(calls.length, 0);
  });

  it("rejects the old unsigned test tokens", async () => {
    const { f } = fakeAuth(() => new Response("{}", { status: 401 }));
    const v = supabaseSessionVerifier({ ...base, fetch: f });
    assert.equal(await v.verifySession("session:2a000000-0000-0000-0000-0000000000c0"), null);
    assert.equal(await v.verifySession("demo-session-token"), null);
  });

  it("fails closed on non-200, network error, timeout and malformed bodies", async () => {
    for (const handler of [
      () => new Response("{}", { status: 500 }),
      () => new Response("{}", { status: 403 }),
      () => { throw new TypeError("network down"); },
      () => new Response("not json", { status: 200 }),
      () => Response.json({ id: 42 }),
      () => Response.json({ id: "not-a-uuid" }),
    ]) {
      const v = supabaseSessionVerifier({ ...base, fetch: fakeAuth(handler).f });
      assert.equal(await v.verifySession(jwt(Date.now() / 1000 + 3600)), null);
    }
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const slow = supabaseSessionVerifier({ ...base, fetch: hang, timeoutMs: 50 });
    assert.equal(await slow.verifySession(jwt(Date.now() / 1000 + 3600)), null);
  });

  it("caches a positive answer for the TTL, then asks again", async () => {
    let t = 1_000_000;
    const { f, calls } = fakeAuth(() => Response.json({ id: USER }));
    const v = supabaseSessionVerifier({ ...base, fetch: f, now: () => t, cacheTtlMs: 60_000 });
    const tok = jwt(t / 1000 + 3600);
    await v.verifySession(tok);
    await v.verifySession(tok);
    assert.equal(calls.length, 1);
    t += 61_000;
    await v.verifySession(tok);
    assert.equal(calls.length, 2);
  });

  it("never caches past the token's exp, and never caches failures", async () => {
    let t = 1_000_000;
    let ok = false;
    const { f, calls } = fakeAuth(() => (ok ? Response.json({ id: USER }) : new Response("{}", { status: 401 })));
    const v = supabaseSessionVerifier({ ...base, fetch: f, now: () => t });
    const tok = jwt(t / 1000 + 5); // expires in 5s
    assert.equal(await v.verifySession(tok), null);
    ok = true;
    assert.deepEqual(await v.verifySession(tok), { userId: USER }); // failure was not cached
    t += 6_000;
    await v.verifySession(tok);
    assert.equal(calls.length, 3); // cached entry expired with the token
  });
});

describe("selectSessionVerifier", () => {
  const test: () => SessionVerifier = () => ({ verifySession: async () => ({ userId: "test" }) });
  it("uses real verification whenever Supabase config is present, even outside production", () => {
    const v = selectSessionVerifier({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k", NODE_ENV: "staging" }, test, "svc");
    assert.notEqual(v, test());
  });
  it("refuses to start in production without Supabase config", () => {
    assert.throws(() => selectSessionVerifier({ NODE_ENV: "production" }, test, "svc"), /required in production/);
  });
  it("falls back to the test verifier only outside production", async () => {
    const v = selectSessionVerifier({ NODE_ENV: "development" }, test, "svc");
    assert.deepEqual(await v.verifySession("x"), { userId: "test" });
  });
});

describe("profile mapping (auth_id -> users.id)", () => {
  const PROFILE = "aaaaaaaa-0000-4000-8000-000000000001";
  it("maps the Supabase user to the linked profile id", async () => {
    const { f } = fakeAuth(() => Response.json({ id: USER, email: "a@b.c" }));
    const v = supabaseSessionVerifier({ ...base, fetch: f, resolveUserId: async (a) => (a === USER ? PROFILE : null) });
    assert.deepEqual(await v.verifySession(jwt(Date.now() / 1000 + 3600)), { userId: PROFILE });
  });
  it("is unauthenticated when the viewer has no profile yet, and does not cache that", async () => {
    let linked = false;
    const { f, calls } = fakeAuth(() => Response.json({ id: USER }));
    const v = supabaseSessionVerifier({ ...base, fetch: f, resolveUserId: async () => (linked ? PROFILE : null) });
    const tok = jwt(Date.now() / 1000 + 3600);
    assert.equal(await v.verifySession(tok), null);
    linked = true;
    assert.deepEqual(await v.verifySession(tok), { userId: PROFILE });
    assert.equal(calls.length, 2);
  });
  it("fails closed when the profile lookup throws", async () => {
    const { f } = fakeAuth(() => Response.json({ id: USER }));
    const v = supabaseSessionVerifier({ ...base, fetch: f, resolveUserId: async () => { throw new Error("db down"); } });
    assert.equal(await v.verifySession(jwt(Date.now() / 1000 + 3600)), null);
  });
  it("pgUserIdResolver queries users by auth_id", async () => {
    const seen: unknown[] = [];
    const r = pgUserIdResolver(async (sql, params) => { seen.push(sql, params); return { rows: [{ id: PROFILE }] }; });
    assert.equal(await r(USER), PROFILE);
    assert.deepEqual(seen, ["select id from users where auth_id = $1 limit 1", [USER]]);
  });
});

describe("supabaseAuthUserVerifier", () => {
  it("returns the verified Supabase subject and email; rejects the old supabase:<id>:<email> stub tokens", async () => {
    const { f } = fakeAuth((t) => (t.startsWith("h.") ? Response.json({ id: USER, email: "a@b.c" }) : new Response("{}", { status: 401 })));
    const v = supabaseAuthUserVerifier({ ...base, fetch: f });
    assert.deepEqual(await v.verifyAccessToken(jwt(Date.now() / 1000 + 3600)), { authId: USER, email: "a@b.c" });
    assert.equal(await v.verifyAccessToken(`supabase:${USER}:a@b.c`), null);
  });
});
