// Route tests for the decision HTTP adapter, exercising the real Hono app over the real decide() handler
// with the in-memory engine deps (InMemoryKV / InMemoryLogger / InMemoryCohortSeeds) and a DB stub. These
// prove the transport and the trust boundary, not the bandit math (decide.test.ts covers that):
//
//   - POST /decide returns 200 with the contract response shape for an authenticated viewer.
//   - identity is taken from the session token, never the body: a user_id smuggled into the body is
//     ignored, and the served decision is the one for the token subject (control vs treatment proves it).
//   - end of graph maps to the contract 422 no_successors.
//   - missing / malformed / non-session token is 401.
//   - malformed JSON is 400; a body missing required fields is 400.
//
// Auth uses the TEST verifier (testVerifiers): session token "session:<uuid>" resolves to that uuid.
// Real JWT/JWKS verification is a flagged stub behind the SessionVerifier interface; it is not exercised
// here. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createDecisionApp } from "./app.js";
import { testVerifiers } from "./auth.js";
import { assignControl } from "../policy.js";
import { canonFilter, type CanonCandidate } from "../canon.js";
import { InMemoryKV } from "../kv.js";
import { InMemoryLogger } from "../logger.js";
import { InMemoryCohortSeeds } from "../features.js";
import type { DecisionDB, DecideDeps } from "../decide.js";

// canonFilter is imported only to keep this test honest about the engine surface it relies on; the
// reference assures the symbol resolves the same way decide() uses it.
void canonFilter;

const CALM = "cccccccc-0000-0000-0000-00000000000a";
const TENSE = "cccccccc-0000-0000-0000-00000000000b";
const SERIES = "11111111-1111-1111-1111-111111111111";
const BEAT = "bbbbbbbb-0000-0000-0000-000000000002";

const baseCandidates: CanonCandidate[] = [
  { variantId: CALM, branch: "calm", validEdge: true },
  { variantId: TENSE, branch: "tense", validEdge: true },
];

function fakeDB(over: Partial<DecisionDB> = {}): DecisionDB {
  return {
    seriesOfBeat: async () => SERIES,
    candidatesOf: async () => baseCandidates,
    canonFactsOf: async () => ({}),
    cohortOf: async () => null,
    adaptiveOptIn: async () => true,
    ...over,
  };
}

function engineDeps(over: Partial<DecideDeps> = {}): DecideDeps {
  return {
    db: fakeDB(),
    kv: new InMemoryKV(),
    logger: new InMemoryLogger(),
    cohorts: new InMemoryCohortSeeds(),
    ...over,
  };
}

function appWith(over: Partial<DecideDeps> = {}) {
  return createDecisionApp({ decisionDeps: engineDeps(over), verifiers: testVerifiers() });
}

// Pick ids that land in a known control bucket so the served decision is deterministic.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuidIn(control: boolean): string {
  // Generate uuid-shaped ids until one falls in the requested bucket. The hex chars give plenty of room.
  for (let i = 0; i < 100000; i++) {
    const hex = i.toString(16).padStart(12, "0");
    const id = `00000000-0000-4000-8000-${hex}`;
    if (!UUID_RE.test(id)) continue;
    if (assignControl(id) === control) return id;
  }
  throw new Error(`no ${control ? "control" : "treatment"} uuid found`);
}

const sessionToken = (userId: string) => `Bearer session:${userId}`;

test("POST /decide returns 200 with the contract response shape for an authenticated viewer", async () => {
  const app = appWith();
  const userId = uuidIn(false); // treatment
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken(userId), "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: BEAT, signals: { completion: 0.9 } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    decision_id: string;
    next_variant_id: string;
    prefetch_variant_ids?: string[];
    is_control: boolean;
    policy_version: string;
  };
  assert.match(body.decision_id, UUID_RE);
  assert.ok(body.next_variant_id === CALM || body.next_variant_id === TENSE);
  assert.ok(Array.isArray(body.prefetch_variant_ids));
  assert.equal(typeof body.is_control, "boolean");
  assert.equal(typeof body.policy_version, "string");
});

test("POST /decide takes identity from the token, not a user_id smuggled in the body", async () => {
  const logger = new InMemoryLogger();
  const app = appWith({ logger });
  const tokenUser = uuidIn(true); // a control-bucket viewer per the token
  const bodyUser = uuidIn(false); // a treatment-bucket viewer the body tries to impersonate
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken(tokenUser), "content-type": "application/json" },
    body: JSON.stringify({ user_id: bodyUser, current_beat_id: BEAT, signals: {} }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { is_control: boolean; next_variant_id: string };
  // The token subject is in the control bucket, so the decision must be the control director's cut,
  // proving the body user_id (a treatment id) was ignored.
  assert.equal(body.is_control, true);
  assert.equal(body.next_variant_id, CALM);
  // And the engine logged the decision for the token subject, never the body user.
  assert.equal(logger.rows.length, 1);
  assert.equal(logger.rows[0].user_id, tokenUser);
});

test("POST /decide end of graph maps to the contract 422 no_successors", async () => {
  const app = appWith({ db: fakeDB({ candidatesOf: async () => [] }) });
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken(uuidIn(false)), "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: BEAT, signals: {} }),
  });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: string }).error, "no_successors");
});

test("POST /decide without a token is 401, before any decision", async () => {
  const app = appWith();
  const res = await app.request("/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: BEAT, signals: {} }),
  });
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, "unauthorized");
});

test("POST /decide with a non-session token is 401", async () => {
  const app = appWith();
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: "Bearer not-a-session-token", "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: BEAT, signals: {} }),
  });
  assert.equal(res.status, 401);
});

test("POST /decide with a non-uuid session subject is 401 (test verifier rejects it)", async () => {
  const app = appWith();
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken("not-a-uuid"), "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: BEAT, signals: {} }),
  });
  assert.equal(res.status, 401);
});

test("POST /decide with malformed JSON is 400", async () => {
  const app = appWith();
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken(uuidIn(false)), "content-type": "application/json" },
    body: "{ not json",
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_json");
});

test("POST /decide with a body missing required fields is 400", async () => {
  const app = appWith();
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: sessionToken(uuidIn(false)), "content-type": "application/json" },
    body: JSON.stringify({ signals: {} }), // no current_beat_id
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_request");
});
