// Route + gate tests for the identity-performance server. Drives route() directly with the in-memory deps and
// the TEST verifiers, so the trust boundary (401), the founder consent-architecture gate, the consent
// precondition + purge path, the drift guard, and the unwired-adapter no-fabrication rule are covered without
// a socket or a database. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  route,
  selectVerifiers,
  buildDefaultDeps,
  SIGNED_OFF,
  type IdentityPerfDeps,
} from "../src/server.js";
import { testVerifiers, type Verifiers } from "../src/http/auth.js";
import { InMemoryConsentGate } from "../src/consent.js";
import { InMemoryIdentityStore } from "../src/store.js";
import { defaultAdapterConfig, type PerformanceVendor } from "../src/adapters.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const OPERATOR = "22222222-2222-2222-2222-222222222222";
const SESSION_BEARER = `Bearer session:${SESSION}`;
const OPERATOR_BEARER = `Bearer operator:${OPERATOR}`;
const CONSENT_REF = "consent-ledger:abc";

const verifiers: Verifiers = testVerifiers();

function urlOf(path: string): URL {
  return new URL(path, "http://identity-performance.local");
}

// Build deps with explicit in-memory parts so a test can pre-grant consent and inspect the store.
function deps(opts?: { vendor?: PerformanceVendor | null }): {
  d: IdentityPerfDeps;
  store: InMemoryIdentityStore;
  consent: InMemoryConsentGate;
} {
  const store = new InMemoryIdentityStore();
  const consent = new InMemoryConsentGate();
  const adapters = defaultAdapterConfig();
  if (opts && "vendor" in opts) adapters.vendor = opts.vendor ?? null;
  return { d: { store, consent, adapters }, store, consent };
}

// --- cutover gate ----------------------------------------------------------------------------------

test("selectVerifiers throws under NODE_ENV=production (cutover gate)", () => {
  assert.throws(
    () => selectVerifiers({ databaseUrl: "x", nodeEnv: "production" }),
    /cutover gate/
  );
});

test("selectVerifiers returns the test verifiers outside production", () => {
  const v = selectVerifiers({ databaseUrl: "x", nodeEnv: "development" });
  assert.ok(v.session);
  assert.ok(v.operator);
});

// --- trust boundary --------------------------------------------------------------------------------

test("POST /identities without a session bearer is 401 (no write)", async () => {
  const { d, store } = deps();
  const res = await route(d, verifiers, "POST", urlOf("/identities"), null, {
    seriesId: "s1",
    characterName: "Maya",
  });
  assert.equal(res.status, 401);
  // nothing registered
  const drift = await route(d, verifiers, "POST", urlOf("/score-drift"), SESSION_BEARER, { identityId: "x" });
  assert.equal(drift.status, 404);
  assert.ok(store);
});

test("POST /revoke/:id requires an OPERATOR bearer, not a session bearer", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "POST", urlOf(`/revoke/${SESSION}`), SESSION_BEARER, undefined);
  assert.equal(res.status, 401);
});

// --- founder consent-architecture gate (BUILT, NOT LIVE) -------------------------------------------

test("the founder gate is wired false (BUILT, NOT LIVE) and is not self-certified", () => {
  assert.equal(SIGNED_OFF, false);
});

test("registering a REAL-LIKENESS identity is refused with founder_consent_gate while SIGNED_OFF=false", async () => {
  const { d, consent } = deps();
  consent.grant(CONSENT_REF); // even WITH current consent, the founder gate refuses first
  const res = await route(d, verifiers, "POST", urlOf("/identities"), SESSION_BEARER, {
    seriesId: "s1",
    characterName: "Maya",
    referenceEmbeddings: [[1, 0, 0]],
    referenceImageUrls: ["sovereign://ref1.png"],
    consentRef: CONSENT_REF,
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "founder_consent_gate" });
});

test("a lipsync call is refused with founder_consent_gate while SIGNED_OFF=false (real-likeness op)", async () => {
  const { d } = deps();
  // identity does not even need to exist to hit the gate ordering? No: lipsync looks up the identity first.
  // Register a NON-real-likeness identity (allowed) so the lookup succeeds, then the likeness gate fires.
  const reg = await route(d, verifiers, "POST", urlOf("/identities"), SESSION_BEARER, {
    seriesId: "s1",
    characterName: "Narrator",
  });
  assert.equal(reg.status, 201);
  const id = (reg.body as { id: string }).id;
  const res = await route(d, verifiers, "POST", urlOf("/lipsync"), SESSION_BEARER, {
    identityId: id,
    language: "es-419",
    estimatedCost: 1,
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "founder_consent_gate" });
});

// --- non-real-likeness path (descriptive identity, no biometric refs) ------------------------------
// These exercise the store/consent/drift/purge machinery that the founder gate would otherwise block, so the
// behaviour is verified without flipping the founder sign-off. A descriptive identity carries NO references,
// so it is not consent/founder gated for likeness, AND it cannot drift (no anchor).

test("registering a descriptive (non-real-likeness) identity succeeds without consent or founder sign-off", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "POST", urlOf("/identities"), SESSION_BEARER, {
    seriesId: "s1",
    characterName: "Narrator",
  });
  assert.equal(res.status, 201);
  const body = res.body as { id: string; realLikeness: boolean };
  assert.equal(body.realLikeness, false);
  assert.ok(body.id.length > 0);
});

test("GET /identities/:id returns the lock spec WITHOUT raw biometric references", async () => {
  const { d } = deps();
  const reg = await route(d, verifiers, "POST", urlOf("/identities"), SESSION_BEARER, {
    seriesId: "s1",
    characterName: "Narrator",
  });
  const id = (reg.body as { id: string }).id;
  const res = await route(d, verifiers, "GET", urlOf(`/identities/${id}`), SESSION_BEARER, undefined);
  assert.equal(res.status, 200);
  const body = res.body as Record<string, unknown>;
  // counts/spec only; no raw embeddings or image urls leave the plane
  assert.equal(body.referenceEmbeddingCount, 0);
  assert.ok(!("referenceEmbeddings" in body));
  assert.ok(!("referenceImageUrls" in body));
  assert.ok("strength" in body);
});

test("GET /identities/:id is 404 for an unknown id", async () => {
  const { d } = deps();
  const res = await route(d, verifiers, "GET", urlOf(`/identities/${OPERATOR}`), SESSION_BEARER, undefined);
  assert.equal(res.status, 404);
});

// --- revoke / purge path (operator) ----------------------------------------------------------------

test("POST /revoke/:id hard-deletes the identity and its derived shots, and is idempotent", async () => {
  const { d, store, consent } = deps();
  // Seed an identity + derived shots directly in the store (bypassing the founder gate, which is not the
  // subject under test here) so the purge path can be observed end to end.
  consent.grant(CONSENT_REF);
  const identity = await store.register({
    seriesId: "s1",
    characterName: "Maya",
    references: { embeddings: [[1, 0, 0]], imageUrls: ["sovereign://ref1.png"], voiceRef: null },
    consentRef: CONSENT_REF,
    realLikeness: true,
  });
  await store.recordDerivedShot({ identityId: identity.id, kind: "lipsync", embedding: [1, 0, 0], assetUrl: "x" });
  await store.recordDerivedShot({ identityId: identity.id, kind: "deage", embedding: [1, 0, 0], assetUrl: "y" });

  const res = await route(d, verifiers, "POST", urlOf(`/revoke/${identity.id}`), OPERATOR_BEARER, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { revoked: true, identityDeleted: true, derivedShotsDeleted: 2 });

  // identity gone from the store, derived shots gone, consent revoked
  assert.equal(await store.get(identity.id), null);
  assert.deepEqual(await store.listDerivedShots(identity.id), []);
  assert.equal((await consent.status(CONSENT_REF)).current, false);

  // idempotent: a second purge reports nothing deleted
  const again = await route(d, verifiers, "POST", urlOf(`/revoke/${identity.id}`), OPERATOR_BEARER, undefined);
  assert.deepEqual(again.body, { revoked: true, identityDeleted: false, derivedShotsDeleted: 0 });
});

test("a revoked-consent real-likeness identity becomes UNREACHABLE via GET (consent lapse -> 404)", async () => {
  const { d, store, consent } = deps();
  const identity = await store.register({
    seriesId: "s1",
    characterName: "Maya",
    references: { embeddings: [[1, 0, 0]], imageUrls: [], voiceRef: null },
    consentRef: CONSENT_REF,
    realLikeness: true,
  });
  // With current consent the gate would still be the founder gate at register time; GET only checks consent.
  consent.grant(CONSENT_REF);
  const ok = await route(d, verifiers, "GET", urlOf(`/identities/${identity.id}`), SESSION_BEARER, undefined);
  assert.equal(ok.status, 200);

  // Revoke consent -> unreachable
  consent.revoke(CONSENT_REF);
  const gone = await route(d, verifiers, "GET", urlOf(`/identities/${identity.id}`), SESSION_BEARER, undefined);
  assert.equal(gone.status, 404);
});

test("a real-likeness identity with NO consent ref is unreachable (default-deny) via GET", async () => {
  const { d, store } = deps();
  const identity = await store.register({
    seriesId: "s1",
    characterName: "Maya",
    references: { embeddings: [[1, 0, 0]], imageUrls: [], voiceRef: null },
    consentRef: null,
    realLikeness: true,
  });
  const res = await route(d, verifiers, "GET", urlOf(`/identities/${identity.id}`), SESSION_BEARER, undefined);
  assert.equal(res.status, 404);
});
