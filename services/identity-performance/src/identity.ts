// Identity-lock spec + deterministic identity-consistency / drift SCORER for the identity-performance
// service. Pure functions, no I/O, unit-tested against fixed vectors.
//
// IDENTITY LOCK: a generated or adapted shot for a character is CONDITIONED on the character's reference
// embeddings/images. This service does not run the model; it produces the LOCK SPEC the model router consumes
// (the reference set + the conditioning parameters) and SCORES the produced shots for identity consistency.
//
// DRIFT GUARD: score identity across a character's shots against the reference, and FLAG drift above a
// threshold for human review before publish. A serialized hero title must NOT publish with un-flagged drift,
// so flagDrift is conservative: any shot below the consistency floor flags the whole set. No em dashes.

import type { CharacterIdentity, DerivedShot, IdentityReferences } from "./store.js";

// The conditioning spec handed to the model router. referenceEmbeddings/referenceImageUrls pin the identity;
// strength is how hard to hold the lock (1.0 = maximal identity preservation). This is an INTERFACE to the
// router; this service never calls a model.
export interface IdentityLockSpec {
  identityId: string;
  characterName: string;
  referenceEmbeddings: number[][];
  referenceImageUrls: string[];
  voiceRef: string | null;
  strength: number;
}

// Default lock strength. Hero/serialized identities hold a high lock so the character stays recognizable
// across episodes; tunable per shot if the router needs slack for an expression/pose.
export const DEFAULT_LOCK_STRENGTH = 0.85;

export function buildLockSpec(identity: CharacterIdentity, strength = DEFAULT_LOCK_STRENGTH): IdentityLockSpec {
  return {
    identityId: identity.id,
    characterName: identity.characterName,
    referenceEmbeddings: identity.references.embeddings,
    referenceImageUrls: identity.references.imageUrls,
    voiceRef: identity.references.voiceRef,
    strength,
  };
}

// --- vector math (cosine similarity) ----------------------------------------------------------------

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

// Cosine similarity in [-1, 1]; identical direction = 1. Zero-magnitude vectors are treated as maximally
// dissimilar (0), never NaN, so a degenerate shot reads as drift rather than crashing the guard.
export function cosineSimilarity(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// Centroid of the reference embeddings: the identity's anchor point in embedding space. A shot is scored
// against this anchor. Returns null when there is no reference (a non-real-likeness identity cannot drift).
export function referenceCentroid(refs: IdentityReferences): number[] | null {
  const set = refs.embeddings;
  if (set.length === 0) return null;
  const dim = set[0].length;
  const acc = new Array<number>(dim).fill(0);
  for (const v of set) {
    for (let i = 0; i < dim; i += 1) acc[i] += v[i] ?? 0;
  }
  for (let i = 0; i < dim; i += 1) acc[i] /= set.length;
  return acc;
}

// --- drift scoring ----------------------------------------------------------------------------------

// Identity consistency floor. A per-shot consistency BELOW this is drift. Conservative by design: a hero
// title with any sub-floor shot must be flagged for human review before publish.
export const DRIFT_THRESHOLD = 0.82;

export interface ShotDriftScore {
  shotId: string;
  // Cosine consistency of this shot against the reference centroid, in [0, 1] (clamped).
  consistency: number;
  // True when this shot is below the consistency floor.
  drifted: boolean;
}

export interface DriftReport {
  identityId: string;
  // Mean consistency across scored shots, in [0, 1]. 1 when there are no scorable shots (nothing to drift).
  meanConsistency: number;
  // Lowest per-shot consistency (the worst offender). 1 when there are no scorable shots.
  minConsistency: number;
  perShot: ShotDriftScore[];
  // HARD GUARD: true when ANY scored shot is below the floor. No serialized hero title publishes with this
  // true and un-reviewed (the publish path consumes this flag).
  flagged: boolean;
  // Shots that could not be scored (no embedding produced yet). Surfaced, never silently counted as passing.
  unscorableShotIds: string[];
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Score a character's shots against the reference embeddings and flag drift above the threshold. Shots with
// no produced embedding are reported as unscorable (an unwired adapter never fabricates one) and are NOT
// counted as passing. With no reference centroid the identity cannot drift (non-real-likeness): mean/min are
// 1 and nothing is flagged.
export function scoreDrift(
  refs: IdentityReferences,
  shots: readonly DerivedShot[],
  threshold = DRIFT_THRESHOLD,
  identityId = ""
): DriftReport {
  const centroid = referenceCentroid(refs);
  const perShot: ShotDriftScore[] = [];
  const unscorableShotIds: string[] = [];

  for (const shot of shots) {
    if (shot.embedding == null) {
      unscorableShotIds.push(shot.id);
      continue;
    }
    if (centroid == null) {
      // No reference to score against: treat as fully consistent (cannot drift without an anchor).
      perShot.push({ shotId: shot.id, consistency: 1, drifted: false });
      continue;
    }
    const consistency = clamp01(cosineSimilarity(centroid, shot.embedding));
    perShot.push({ shotId: shot.id, consistency, drifted: consistency < threshold });
  }

  const scored = perShot.map((s) => s.consistency);
  const meanConsistency = scored.length === 0 ? 1 : scored.reduce((a, b) => a + b, 0) / scored.length;
  const minConsistency = scored.length === 0 ? 1 : Math.min(...scored);
  const flagged = perShot.some((s) => s.drifted);

  return {
    identityId,
    meanConsistency,
    minConsistency,
    perShot,
    flagged,
    unscorableShotIds,
  };
}
