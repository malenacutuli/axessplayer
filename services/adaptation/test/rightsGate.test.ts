// Rights/consent gate units. The HARD block: a rights-missing source is RED and blocked; a
// likeness/voice action needs current consent; a revocation purges the likeness-derived variants but
// spares non-likeness ones. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateOverall,
  evaluateForCapability,
  purgeOnRevocation,
  refreshConsent,
  type RightsChecklist,
} from "../src/rightsGate.js";

function fullRights(over: Partial<RightsChecklist> = {}): RightsChecklist {
  return {
    ownsFootage: true,
    actorAdaptationRights: true,
    voiceRights: true,
    likenessRights: true,
    musicRights: true,
    territoryCleared: true,
    brandLogoCleared: true,
    aiTransformationAllowed: true,
    ageSensitiveReviewed: true,
    consentRef: "consent:abc",
    consentCurrent: true,
    ...over,
  };
}

function emptyRights(): RightsChecklist {
  return {
    ownsFootage: false,
    actorAdaptationRights: false,
    voiceRights: false,
    likenessRights: false,
    musicRights: false,
    territoryCleared: false,
    brandLogoCleared: false,
    aiTransformationAllowed: false,
    ageSensitiveReviewed: false,
    consentRef: null,
    consentCurrent: false,
  };
}

test("a brand-new (empty) rights checklist is RED and blocks any capability", () => {
  const c = emptyRights();
  assert.equal(evaluateOverall(c), "red");
  const ev = evaluateForCapability(c, "vertical_reframe");
  assert.equal(ev.blocked, true);
  assert.ok(ev.reasons.includes("footage_not_owned_or_controlled"));
});

test("full rights is GREEN and a Tier A capability is not blocked", () => {
  const c = fullRights();
  assert.equal(evaluateOverall(c), "green");
  assert.equal(evaluateForCapability(c, "vertical_reframe").blocked, false);
});

test("a likeness capability with no current consent is BLOCKED even when boxes are checked", () => {
  const c = fullRights({ consentCurrent: false });
  const ev = evaluateForCapability(c, "actor_replacement");
  assert.equal(ev.blocked, true);
  assert.ok(ev.reasons.includes("consent_revoked_or_expired"));
});

test("a likeness capability with no consent ref at all is BLOCKED", () => {
  const c = fullRights({ consentRef: null, consentCurrent: false });
  const ev = evaluateForCapability(c, "lip_sync");
  assert.equal(ev.blocked, true);
  assert.ok(ev.reasons.includes("consent_reference_missing"));
});

test("missing AI-transformation permission is a hard RED block", () => {
  const c = fullRights({ aiTransformationAllowed: false });
  assert.equal(evaluateOverall(c), "red");
  assert.equal(evaluateForCapability(c, "captioning").blocked, true);
});

test("revocation purges only the likeness/voice-derived variants", () => {
  const purged = purgeOnRevocation([
    { variantId: "v_reframe", transformation: "vertical_reframe" },
    { variantId: "v_dub", transformation: "dub" },
    { variantId: "v_actor", transformation: "actor_replacement" },
    { variantId: "v_poster", transformation: "poster" },
  ]);
  assert.deepEqual(purged.sort(), ["v_actor", "v_dub"].sort());
});

test("refreshConsent folds a ledger revocation into the checklist", async () => {
  const c = fullRights({ consentRef: "consent-revoked:x" });
  const refreshed = await refreshConsent(c, { async checkCurrent(ref) { return !ref.startsWith("consent-revoked:"); } });
  assert.equal(refreshed.consentCurrent, false);
});
