// Release gate for real session verification, run by hand against a STAGING Supabase project with a real
// signed-in session. Not a *.test.ts file, so CI never runs it (it needs a live auth server and a token).
//
//   STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co \
//   STAGING_SUPABASE_ANON_KEY=<staging anon key> \
//   STAGING_ACCESS_TOKEN=<access token of a staging test user> \
//   node --import tsx src/sessionAuth.staging.ts
//
// Stands up the real economy app (NODE_ENV=production) and the real settlement server over a fresh local
// Postgres, links a profile to the staging user via users.auth_id, then checks: the real session is
// accepted and mapped to the profile; forged and old test tokens are refused; a Supabase outage refuses
// (fail closed); reward routes credit the session subject, not a body userId. No em dashes.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { startPg } from "./pg.js";
import { buildEconomyApp } from "../../../services/economy/src/server.js";
import { createSettlementServer } from "../../../services/monetization/src/server.js";
import type { GrantRequest } from "../../../services/monetization/src/grant.js";
import { selectSessionVerifier, pgUserIdResolver } from "../../../packages/session-auth/src/index.js";

const url = process.env.STAGING_SUPABASE_URL ?? "";
const anon = process.env.STAGING_SUPABASE_ANON_KEY ?? "";
const token = process.env.STAGING_ACCESS_TOKEN ?? "";
if (!url || !anon || !token) throw new Error("set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_ACCESS_TOKEN");

// The staging user id behind the token, straight from Supabase (also proves the token is live).
const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
assert.equal(who.status, 200, "staging token must be a live session");
const authId = ((await who.json()) as { id: string }).id;

const { pool, stop } = await startPg();
const results: string[] = [];
const ok = (name: string) => results.push(`PASS ${name}`);
try {
  // Production schema links profiles to Supabase logins via users.auth_id (not yet in the repo migrations).
  await pool.query("alter table users add column if not exists auth_id uuid");
  const profileId = randomUUID();
  await pool.query("insert into users (id, email, auth_id) values ($1, $2, $3)", [profileId, `staging-${profileId}@example.com`, authId]);

  const run = (env: Record<string, string | undefined>) => {
    const saved = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY };
    Object.assign(process.env, env);
    const app = buildEconomyApp(pool, { databaseUrl: "unused", nodeEnv: "production", serviceSecret: randomUUID() });
    Object.assign(process.env, saved);
    return (bearer: string | null) =>
      app.fetch(new Request("http://economy/wallet", { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }));
  };

  const economy = run({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anon });
  const real = await economy(token);
  assert.notEqual(real.status, 401, `real session must pass auth (got ${real.status})`);
  ok(`economy /wallet accepts the real staging session (HTTP ${real.status})`);

  for (const bad of [null, "session:2a000000-0000-0000-0000-0000000000c0", `session:${profileId}`, "demo-session-token", anon, token.slice(0, -4) + "AAAA"]) {
    assert.equal((await economy(bad)).status, 401, `must refuse ${bad === null ? "no token" : bad.slice(0, 24)}`);
  }
  ok("economy /wallet refuses no token, old test tokens, the anon key, and a tampered JWT (401)");

  const outage = run({ SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: anon });
  assert.equal((await outage(token)).status, 401);
  ok("Supabase unreachable: the real session is refused (fail closed, 401)");

  const grants: GrantRequest[] = [];
  const settlement = createSettlementServer(
    { async grant(g) { grants.push(g); return { balance: 0 }; } },
    {
      sessionVerifier: selectSessionVerifier(
        { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, NODE_ENV: "production" },
        () => ({ verifySession: async () => null }),
        "settlement",
        pgUserIdResolver((sql, params) => pool.query(sql, params)),
      ),
    },
  );
  await new Promise<void>((r) => settlement.listen(0, "127.0.0.1", r));
  const sbase = `http://127.0.0.1:${(settlement.address() as AddressInfo).port}`;
  const post = (path: string, bearer: string | null, body: unknown) =>
    fetch(`${sbase}${path}`, { method: "POST", body: JSON.stringify(body), headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
  try {
    assert.equal((await post("/reward/checkin", null, { userId: profileId })).status, 401);
    assert.equal((await post("/reward/checkin", `session:${profileId}`, { userId: profileId })).status, 401);
    ok("settlement reward routes refuse missing and forged sessions (401), no grant");
    assert.equal(grants.length, 0);
    const victim = randomUUID();
    const res = await post("/reward/follow", token, { userId: victim });
    assert.equal(res.status, 200);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].userId, profileId, "grant must go to the session's profile, not the body userId");
    ok("settlement credits the session's profile and ignores the body userId");
  } finally {
    settlement.close();
  }
} finally {
  await stop();
  console.log(results.join("\n"));
}
