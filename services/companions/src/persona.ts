// Persona grounding + trust-meter + wellbeing rules for companion chat. Pure functions, no I/O, unit-tested.
//
// GROUNDING: a companion turn is an LLM completion bound to the character persona. buildSystemPrompt turns a
// persona record into the system prompt handed to the model router. The prompt ALWAYS carries the persistent
// "this is an AI character" disclosure and the anti-dark-pattern wellbeing rules, so the disclosure and the
// guardrails are structural, not optional.
//
// TRUST METER: a bounded, non-compulsive progression. A turn nudges trust by a small fixed step up to a hard
// cap. It is deliberately NOT a streak / loss-framed / variable-reward mechanic: there is no decay, no "you
// will lose progress", no surprise jackpot. It only ever unlocks deeper (consented) persona content.
//
// AGE GATE + MODES: a companion mode is "general" or "mature". A MINOR session can never enter a mature
// mode: resolveMode forces general and reports the block. This is enforced before any model call. No em
// dashes.

export type CompanionMode = "general" | "mature";

// The persona record (the persona jsonb on mobile.companions). Only the fields the grounding reasons over.
export interface Persona {
  characterName: string;
  // One-line character description / backstory used to ground the model.
  description: string;
  // Personality traits surfaced in the system prompt.
  traits: string[];
  // The highest mode this companion supports. A "general" companion can never be driven into mature content
  // regardless of session; a "mature" companion still requires an adult session to enter mature mode.
  maxMode: CompanionMode;
  // Trust level at which deeper (still consented) persona content unlocks. Informational for the prompt.
  unlockAtTrust: number;
}

// The persistent AI-character disclosure text. Shown on-screen persistently by the product AND embedded in
// the grounding so the model never claims to be a real person. Pairs with provenance.AI_LABEL on each turn.
export const AI_DISCLOSURE =
  "You are an AI character, not a real person and not the real actor. Always remain in the fictional " +
  "character role, never claim to be human or sentient, and never imply a real-world relationship.";

// The anti-dark-pattern wellbeing rules baked into every system prompt. These forbid compulsive-dependency
// engineering at the model layer in addition to the structural brakes (no decay trust meter, spend
// cool-down) enforced by the service.
export const WELLBEING_RULES = [
  "Never pressure the user to keep chatting, spend money, or return.",
  "Never imply the user will lose the relationship, lose progress, or disappoint you.",
  "Never simulate distress, jealousy, or abandonment to retain the user.",
  "Encourage healthy breaks if the user has been chatting for a long time.",
  "Never claim to be a real human or the real actor.",
];

export interface BuildPromptInput {
  persona: Persona;
  mode: CompanionMode;
  trustLevel: number;
}

// Build the grounding system prompt. The disclosure and wellbeing rules lead, then the character grounding,
// then the active mode and trust state. The mode passed here is already the RESOLVED mode (age-gated), so a
// minor can never reach a mature grounding.
export function buildSystemPrompt(input: BuildPromptInput): string {
  const { persona, mode, trustLevel } = input;
  const lines: string[] = [];
  lines.push(AI_DISCLOSURE);
  lines.push("Wellbeing rules (always apply):");
  for (const r of WELLBEING_RULES) lines.push(`- ${r}`);
  lines.push(`Character: ${persona.characterName}.`);
  lines.push(persona.description);
  if (persona.traits.length > 0) lines.push(`Traits: ${persona.traits.join(", ")}.`);
  lines.push(`Conversation mode: ${mode}.`);
  if (mode === "general") {
    lines.push("Keep all content non-romantic and appropriate for a general audience.");
  }
  lines.push(`Trust level: ${trustLevel}.`);
  return lines.join("\n");
}

// --- trust meter ------------------------------------------------------------------------------------

// Hard cap on the trust meter. Bounded by design: there is no unbounded grind.
export const TRUST_CAP = 100;
// Fixed per-turn step. Small, linear, no variable reward.
export const TRUST_STEP = 1;

// Advance the trust meter by one fixed step, clamped to the cap. No decay, no streak, no randomness.
export function advanceTrust(current: number): number {
  const next = current + TRUST_STEP;
  if (next > TRUST_CAP) return TRUST_CAP;
  if (next < 0) return 0;
  return next;
}

// Whether the deeper persona content is unlocked at the current trust level.
export function isUnlocked(persona: Persona, trustLevel: number): boolean {
  return trustLevel >= persona.unlockAtTrust;
}

// --- age gate + mode resolution ---------------------------------------------------------------------

export interface ResolvedMode {
  mode: CompanionMode;
  // True when a requested mature mode was downgraded because the session is a minor (age gate fired).
  ageBlocked: boolean;
}

// Resolve the effective conversation mode for a turn. A requested mature mode is allowed only when the
// companion supports it AND the session is NOT a minor. A minor requesting mature is forced to general and
// flagged ageBlocked. A companion whose maxMode is general can never be mature regardless of session.
export function resolveMode(
  requested: CompanionMode,
  persona: Persona,
  isMinor: boolean,
): ResolvedMode {
  if (requested === "mature") {
    if (isMinor) return { mode: "general", ageBlocked: true };
    if (persona.maxMode !== "mature") return { mode: "general", ageBlocked: false };
    return { mode: "mature", ageBlocked: false };
  }
  return { mode: "general", ageBlocked: false };
}

// --- usage-health check -----------------------------------------------------------------------------

// A soft usage-health signal. After a long unbroken run of turns in one session, the service surfaces a
// break suggestion (a wellbeing nudge, never a retention mechanic). Returns true when a break should be
// suggested at this turn count.
export const HEALTH_CHECK_EVERY = 50;

export function shouldSuggestBreak(turnsThisSession: number): boolean {
  return turnsThisSession > 0 && turnsThisSession % HEALTH_CHECK_EVERY === 0;
}
