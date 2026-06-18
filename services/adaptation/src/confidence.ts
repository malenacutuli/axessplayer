// The confidence scorer. Maps a capability + signal features to a confidence band that decides the
// interaction mode (prompt 23):
//   high   -> ONE-CLICK (Tier A only; applied with no human in the loop).
//   medium -> PREVIEW + REVIEW (a 15s preview is rendered, a human approves).
//   low    -> REQUIRE PROMPT / HUMAN EDIT (the operator must supply a prompt and a human edits/approves).
//
// The band is bounded BY TIER so the scorer can never promote a risky action into one-click:
//   Tier A caps at high; Tier B caps at medium (never one-click, always at least preview+review);
//   Tier C is FORCED to low and low-confidence-flagged regardless of the raw score. This is the hard
//   guarantee that a Tier C action is never auto-applied. No em dashes.

import type { Capability, Confidence, Tier } from "./tiers.js";
import { tierOf } from "./tiers.js";

// Per-capability raw quality signals, all 0..1 (1 = best). The scorer combines them into a raw score.
// Absent signals default conservatively (treated as 0.5) so a thin source never inflates confidence.
export interface ConfidenceSignals {
  // How clean the source probe is (resolution/codec/duration known and sane).
  sourceQuality?: number;
  // How well the capability's preconditions are met (e.g. scenes detected, transcript available).
  preconditionCoverage?: number;
  // The adapter's self-reported reliability for this exact input.
  adapterReliability?: number;
}

export interface ConfidenceResult {
  tier: Tier;
  band: Confidence;
  score: number; // 0..1 the raw blended score, before the tier cap
  lowConfidenceFlagged: boolean; // always true for Tier C; true when band resolves to low
  mode: "one_click" | "preview_review" | "require_prompt";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function signal(v: number | undefined): number {
  return v == null ? 0.5 : clamp01(v);
}

// Raw blended score: equal weight across the three signals. Deterministic and pure so it unit-tests.
export function rawScore(signals: ConfidenceSignals): number {
  const s =
    signal(signals.sourceQuality) +
    signal(signals.preconditionCoverage) +
    signal(signals.adapterReliability);
  return clamp01(s / 3);
}

// The raw band from the score, before the tier cap. >= 0.8 high, >= 0.5 medium, else low.
function rawBand(score: number): Confidence {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// Apply the tier cap. Tier A may reach high; Tier B caps at medium; Tier C is forced to low.
function capByTier(tier: Tier, band: Confidence): Confidence {
  if (tier === "C") return "low";
  if (tier === "B" && band === "high") return "medium";
  return band;
}

function modeFor(band: Confidence): ConfidenceResult["mode"] {
  if (band === "high") return "one_click";
  if (band === "medium") return "preview_review";
  return "require_prompt";
}

export function scoreConfidence(capability: Capability, signals: ConfidenceSignals): ConfidenceResult {
  const tier = tierOf(capability);
  const score = rawScore(signals);
  const band = capByTier(tier, rawBand(score));
  return {
    tier,
    band,
    score,
    lowConfidenceFlagged: tier === "C" || band === "low",
    mode: modeFor(band),
  };
}
