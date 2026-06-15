// Decision policy primitives. Pure functions, no IO, unit testable.
//
// W3 NOTE: the real per-viewer policy is the LinUCB contextual bandit in bandit.ts. The deterministic
// stub below (chooseBranch) is KEPT INTENTIONALLY as the fallback/baseline: it is what control viewers,
// the timeout/opt-out/error path, and the test baseline use. Do not delete it. No em dashes.

import { createHash } from "node:crypto";
import { CONTROL_HOLDOUT_PCT } from "./config.js";

export const DIRECTORS_CUT: Branch = "calm"; // default served to control and on any uncertainty

export type Branch = "calm" | "tense";
export type Candidate = { variantId: string; branch: Branch };
export type ViewerState = { intensity?: number };

// Stable control assignment: a consistent hash of user_id so the same viewer always lands in the same
// arm, stable across sessions (design 6: you cannot measure lift if viewers flip arms). controlPct
// defaults to the configured global holdout (PLACEHOLDER 2). Realized share drifts on small finite id
// sets; on a real population this converges to controlPct (measure the actual, do not trust nominal).
export function assignControl(userId: string, controlPct = CONTROL_HOLDOUT_PCT): boolean {
  const h = createHash("sha256").update(userId).digest();
  const bucket = h[0] % 100; // 0..99, uniform and stable for a given userId
  return bucket < controlPct;
}

// Deterministic baseline / fallback policy. Control always gets the director's cut. Treatment uses the
// viewer intensity. This is the safe cut returned on timeout, opt-out, or any error, and the baseline
// the bandit's lift is measured against.
export function chooseBranch(
  candidates: Candidate[],
  viewer: ViewerState,
  isControl: boolean
): Candidate {
  const calm = candidates.find((c) => c.branch === DIRECTORS_CUT);
  const tense = candidates.find((c) => c.branch === "tense");
  const fallback = calm ?? candidates[0];
  if (isControl) return fallback; // director's cut
  const intensity = viewer.intensity ?? 3;
  return intensity >= 4 ? tense ?? fallback : fallback;
}

// The director's cut among a set of variant ids. Used by the handler's fail-safe path when no branch
// metadata is available: the first candidate is the canonical director's cut ordering.
export function directorsCutOf<T extends { variantId: string }>(candidates: T[]): T {
  return candidates[0];
}
