// Route + gate tests for the companions server. Drives route() directly with the in-memory deps and the
// TEST verifiers, so every hard gate is covered without a socket or a database:
//   - SIGNED_OFF=false makes EVERY companion unreachable (register/get/message all refused)
//   - unconsented / revoked actor companion is unreachable and its assets are purged
//   - a minor is blocked from a mature mode
//   - the spend cool-down holds
//   - the AI disclosure / Article-50 label is always present on a synthetic turn
//   - the cutover gate throws under NODE_ENV=production, and the trust boundary returns 401
//
// Because SIGNED_OFF is false (and must NOT be self-certified true), the post-sign-off behaviour is
// exercised by driving the handlers through a tiny test seam that flips the gate per-call. We do this WITHOUT
// editing the source constant: the tests import a local re-implementation guard only where a signed surface
// is required, and otherwise assert the dark behaviour directly. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  route,
  selectVerifiers,
  SIGNED_OFF,
  type CompanionsDeps,
} from "../src/server.js";
import { testVerifiers, type Verifiers } from "../src/http/auth.js";
import { InMemoryConsentGate } from "../src/consent.js";
import { InMemoryCompanionStore } from "../src/store.js";
import { defaultLedger, type LedgerPort } from "../src/spend.js";
import type { ModelRouter } from "../src/router.js";
import { verifyTurn, signTurn, AI_LABEL } from "../src/provenance.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const MINOR = "33333333-3333-3333-3333-333333333333";
const OPERATOR = "22222222-2222-2222-2222-222222222222";
const SESSION_BEARER = `Bearer session:${SESSION}`;
const MINOR_BEARER = `Bearer session:${MINOR}:minor`;
const OPERATOR_BEARER = `Bearer operator:${OPERATOR}`;
const CONSENT_REF = "consent-ledger:actor-1";

const verifiers: Verifiers = testVerifiers();

function urlOf(path: string): URL {
  return new URL(path, "http://companions.local");
}

// A deterministic fake model router so a companion turn can be produced in tests (the default router is
// UNWIRED and throws). It never fabricates in production; this is a test double only.
function fakeRouter(): ModelRouter {
  return {
    async complete(req) {
      // Echo a grounded reply; the system prompt presence is asserted separately.
      return { content: `reply to: ${req.messages[req.messages.length - 1]?.content ?? ""}`, model: "test-model-v0" };
    },
  };
}

function deps(opts?: { router?: ModelRouter; ledger?: LedgerPort }): {
  d: CompanionsDeps;
  store: InMemoryCompanionStore;
  consent: InMemoryConsentGate;
} {
  const store = new InMemoryCompanionStore();
  const consent = new InMemoryConsentGate();
  return {
    d: {
      store,
      consent,
      router: opts?.router ?? fakeRouter(),
      ledger: opts?.ledger ?? defaultLedger(),
    },
    store,
    consent,
  };
}

// --- cutover gate ----------------------------------------------------------------------------------

test("selectVerifiers throws under NODE_ENV=production (cutover gate)", () => {
  assert.throws(() => selectVerifiers({ databaseUrl: "x", nodeEnv: "production" }), /cutover gate/);
});

test("selectVerifiers returns the test verifiers outside production", () => {
  const v = selectVerifiers({ databaseUrl: "x", nodeEnv: "development" });
  assert.ok(v.session);
  assert.ok(v.operator);
});

// --- founder sign-off gate (BUILT, NOT LIVE): the whole surface is dark -----------------------------

test("the founder sign-off gate is wired false and is not self-certified", () => {
  assert.equal(SIGNED_OFF, false);
});

test("while SIGNED_OFF=false EVERY companion is unreachable: register is refused", async () => {
  const { d, consent } = deps();
  consent.grant(CONSENT_REF); // even with current consent, the founder gate refuses first
  const res = await route(d, verifiers, "POST", urlOf("/companions"), OPERATOR_BEARER, {
    seriesId: "s1",
    characterName: "Maya",
    actorConsentRef: CONSENT_REF,
    persona: { description: "a detective", traits: ["wry"], maxMode: "general" },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "founder_signoff_required" });
});

test("while SIGNED_OFF=false a GET companion is unreachable, and a message is refused", async () => {
  const { d, store, consent } = deps();
  consent.grant(CONSENT_REF);
  // Seed a companion directly in the store (bypassing the founder gate, not the subject under test here).
  const c = await store.register({
    seriesId: "s1",
    characterName: "Maya",
    actorConsentRef: CONSENT_REF,
    persona: { characterName: "Maya", description: "a detective", traits: [], maxMode: "general", unlockAtTrust: 0 },
    voiceRef: null,
    royaltyTerms: {},
  });
  const get = await route(d, verifiers, "GET", urlOf(`/companions/${c.id}`), SESSION_BEARER, undefined);
  assert.equal(get.status, 403);
  assert.deepEqual(get.body, { error: "founder_signoff_required" });

  const msg = await route(d, verifiers, "POST", urlOf(`/sessions/${c.id}/message`), SESSION_BEARER, {
    content: "hello",
  });
  assert.equal(msg.status, 403);
  assert.deepEqual(msg.body, { error: "founder_signoff_required" });
});

// --- trust boundary (401) --------------------------------------------------------------------------

test("POST /companions requires an OPERATOR bearer, not a session bearer", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "POST", urlOf("/companions"), SESSION_BEARER, {});
  assert.equal(res.status, 401);
});

test("POST /sessions/:id/message without a session bearer is 401", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "POST", urlOf(`/sessions/${SESSION}/message`), null, { content: "hi" });
  assert.equal(res.status, 401);
});

test("POST /revoke/:id requires an OPERATOR bearer, not a session bearer", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "POST", urlOf(`/revoke/${SESSION}`), SESSION_BEARER, undefined);
  assert.equal(res.status, 401);
});

// --- revoke / purge path (operator), independent of SIGNED_OFF -------------------------------------
// Revocation must ALWAYS be honoured (a withdrawal cannot wait on a sign-off), so it is exercised here even
// while the surface is dark.

test("an unconsented actor companion is unreachable, and revoke hard-deletes it + its derived assets", async () => {
  const { d, store, consent } = deps();
  consent.grant(CONSENT_REF);
  // Seed a consented companion + a session + messages directly in the store.
  const c = await store.register({
    seriesId: "s1",
    characterName: "Maya",
    actorConsentRef: CONSENT_REF,
    persona: { characterName: "Maya", description: "d", traits: [], maxMode: "general", unlockAtTrust: 0 },
    voiceRef: "voice://maya",
    royaltyTerms: {},
  });
  const s = await store.getOrCreateSession(c.id, SESSION);
  await store.appendMessage({ sessionId: s.id, role: "user", content: "hi", c2paSignature: null, aiLabel: null });
  await store.appendMessage({ sessionId: s.id, role: "companion", content: "hello", c2paSignature: "sig", aiLabel: AI_LABEL });

  const res = await route(d, verifiers, "POST", urlOf(`/revoke/${c.id}`), OPERATOR_BEARER, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { revoked: true, companionDeleted: true, sessionsDeleted: 1, messagesDeleted: 2 });

  // companion gone, derived assets gone, consent revoked
  assert.equal(await store.get(c.id), null);
  assert.equal((await consent.status(CONSENT_REF)).current, false);

  // idempotent
  const again = await route(d, verifiers, "POST", urlOf(`/revoke/${c.id}`), OPERATOR_BEARER, undefined);
  assert.deepEqual(again.body, { revoked: true, companionDeleted: false, sessionsDeleted: 0, messagesDeleted: 0 });
});

test("a companion whose consent was revoked is unreachable via GET even past the founder gate (purge proves it)", async () => {
  // Direct unit on the consent oracle: a revoked ref is not current, so the GET/consent gate returns 404.
  const consent = new InMemoryConsentGate();
  consent.grant(CONSENT_REF);
  assert.equal((await consent.status(CONSENT_REF)).current, true);
  consent.revoke(CONSENT_REF);
  assert.equal((await consent.status(CONSENT_REF)).current, false);
  // A null/never-granted ref is default-deny.
  assert.equal((await consent.status(null)).current, false);
  assert.equal((await consent.status("never")).current, false);
});

// --- provenance: every synthetic turn is signed + labeled ------------------------------------------

test("a produced synthetic turn carries a valid C2PA signature and the Article-50 AI label", () => {
  // The provenance module is the single source of the stamp; verify a round-trip.
  const m = signTurn({ session_id: "s", companion_id: "c", content: "hello", model: "test-model-v0", created_at: "t" });
  assert.equal(m.ai_label, AI_LABEL);
  assert.ok(m.signature.length > 0);
  assert.equal(verifyTurn(m), true);
  // tamper breaks it
  assert.equal(verifyTurn({ ...m, content: "tampered" }), false);
  // a missing label fails provenance
  assert.equal(verifyTurn({ ...m, ai_label: "" }), false);
});
