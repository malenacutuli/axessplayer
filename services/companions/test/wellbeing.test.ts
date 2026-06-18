// Wellbeing + gate-logic unit tests for the companions service. These exercise the SAME pure functions the
// route handlers use for the post-sign-off behaviour, WITHOUT flipping the founder sign-off constant (which
// must never be self-certified true). The route tests cover the dark-surface gating; these cover the
// guardrail logic that runs once the surface is live:
//   - a MINOR is blocked from a mature/romantic mode (forced to general)
//   - the spend COOL-DOWN holds between paid actions
//   - the persistent AI-character disclosure and anti-dark-pattern rules are always in the grounding
//   - the trust meter is bounded and non-compulsive (no decay, fixed step, hard cap)
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveMode,
  buildSystemPrompt,
  advanceTrust,
  isUnlocked,
  shouldSuggestBreak,
  AI_DISCLOSURE,
  WELLBEING_RULES,
  TRUST_CAP,
  type Persona,
} from "../src/persona.js";
import {
  inSpendCooldown,
  nextCooldownUntil,
  royaltyIntentFromTerms,
  SPEND_COOLDOWN_MS,
} from "../src/spend.js";

const matureCompanion: Persona = {
  characterName: "Maya",
  description: "a noir detective",
  traits: ["wry", "guarded"],
  maxMode: "mature",
  unlockAtTrust: 10,
};
const generalCompanion: Persona = { ...matureCompanion, maxMode: "general" };

// --- AGE GATE: minors blocked from mature/romantic modes entirely -----------------------------------

test("a MINOR requesting a mature mode is forced to general and flagged ageBlocked", () => {
  const r = resolveMode("mature", matureCompanion, true);
  assert.equal(r.mode, "general");
  assert.equal(r.ageBlocked, true);
});

test("an adult may enter a mature mode on a mature-capable companion", () => {
  const r = resolveMode("mature", matureCompanion, false);
  assert.equal(r.mode, "mature");
  assert.equal(r.ageBlocked, false);
});

test("a general-only companion can never be mature, even for an adult (not age-blocked, just unsupported)", () => {
  const r = resolveMode("mature", generalCompanion, false);
  assert.equal(r.mode, "general");
  assert.equal(r.ageBlocked, false);
});

// --- AI DISCLOSURE always present in the grounding --------------------------------------------------

test("the system prompt always carries the persistent AI-character disclosure and wellbeing rules", () => {
  const prompt = buildSystemPrompt({ persona: matureCompanion, mode: "general", trustLevel: 0 });
  assert.ok(prompt.includes(AI_DISCLOSURE));
  for (const rule of WELLBEING_RULES) assert.ok(prompt.includes(rule));
  assert.ok(prompt.includes("Maya"));
});

// --- SPEND COOL-DOWN holds --------------------------------------------------------------------------

test("inSpendCooldown is false with no prior spend, true immediately after, false once elapsed", () => {
  const now = new Date("2026-06-18T00:00:00.000Z");
  assert.equal(inSpendCooldown(null, now), false);

  const until = nextCooldownUntil(now);
  // immediately after a spend: still inside the window
  assert.equal(inSpendCooldown(until, new Date(now.getTime() + 1)), true);
  // just before the window closes: still inside
  assert.equal(inSpendCooldown(until, new Date(now.getTime() + SPEND_COOLDOWN_MS - 1)), true);
  // at/after the window: clear
  assert.equal(inSpendCooldown(until, new Date(now.getTime() + SPEND_COOLDOWN_MS)), false);
});

// --- TRUST METER bounded + non-compulsive -----------------------------------------------------------

test("the trust meter advances by a fixed step and is hard-capped (no unbounded grind)", () => {
  let t = 0;
  for (let i = 0; i < TRUST_CAP + 50; i += 1) t = advanceTrust(t);
  assert.equal(t, TRUST_CAP);
});

test("deeper content unlocks only at the configured trust level", () => {
  assert.equal(isUnlocked(matureCompanion, 9), false);
  assert.equal(isUnlocked(matureCompanion, 10), true);
});

test("a usage-health break is suggested on long unbroken runs only", () => {
  assert.equal(shouldSuggestBreak(0), false);
  assert.equal(shouldSuggestBreak(1), false);
  assert.equal(shouldSuggestBreak(50), true);
  assert.equal(shouldSuggestBreak(100), true);
});

// --- ACTOR ROYALTY intent (interface only; accrual is authoritative in economy/settlement) ----------

test("royaltyIntentFromTerms resolves a clamped actor share and payee, defaulting to no accrual", () => {
  assert.deepEqual(royaltyIntentFromTerms({ actor_share: 0.2, actor_payee_ref: "actor:maya" }), {
    share: 0.2,
    payeeRef: "actor:maya",
  });
  // clamped to [0, 1]
  assert.equal(royaltyIntentFromTerms({ actor_share: 5 }).share, 1);
  assert.equal(royaltyIntentFromTerms({ actor_share: -1 }).share, 0);
  // missing / invalid -> no accrual, never NaN
  assert.deepEqual(royaltyIntentFromTerms({}), { share: 0, payeeRef: null });
  assert.deepEqual(royaltyIntentFromTerms(null), { share: 0, payeeRef: null });
  assert.equal(royaltyIntentFromTerms({ actor_share: "x" as unknown as number }).share, 0);
});
