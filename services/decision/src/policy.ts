// Minimal decision policy for the walking skeleton. Pure functions, no IO, so they are unit testable.
// PRODUCTION NOTE: the real policy is W3 (a contextual bandit in Python or Rust) and is load-bearing.
// It requires human design and sign-off per 05_SECURITY_AND_COMPLIANCE.md. This is a deterministic
// stand-in, good enough to prove the adaptive path and the control holdout end to end. No em dashes.

import { createHash } from "node:crypto";

export const DIRECTORS_CUT: Branch = "calm"; // default served to control and on any uncertainty

export type Branch = "calm" | "tense";
export type Candidate = { variantId: string; branch: Branch };
export type ViewerState = { intensity?: number };

// Stable control assignment: the same user always lands in the same arm.
export function assignControl(userId: string, controlPct = 10): boolean {
  const h = createHash("sha256").update(userId).digest();
  const bucket = h[0] % 100; // 0..99, uniform and stable for a given userId
  return bucket < controlPct;
}

// Choose the next branch. Control always gets the director's cut. Treatment uses the viewer intensity.
export function chooseBranch(
  candidates: Candidate[],
  viewer: ViewerState,
  isControl: boolean
): Candidate {
  const calm = candidates.find(c => c.branch === DIRECTORS_CUT);
  const tense = candidates.find(c => c.branch === "tense");
  const fallback = calm ?? candidates[0];
  if (isControl) return fallback; // director's cut
  const intensity = viewer.intensity ?? 3;
  return intensity >= 4 ? (tense ?? fallback) : fallback;
}
