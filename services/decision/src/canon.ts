// Canon safety: a HARD pre-filter applied BEFORE the policy ranks anything. The arm set the bandit
// sees is ONLY valid successors in beat_edges that do not violate the originating beat's canon_facts. A
// wrong-but-engaging cut that breaks the story is a defect, not a win (design 2). No em dashes.

import type { Candidate } from "./policy.js";

// canon_facts is JSONB on beats: a flat map of fact name -> required value that any successor variant
// must not contradict. A variant carries the facts it asserts; if it contradicts a required fact it is
// removed from the arm set before ranking.
export type CanonFacts = Record<string, unknown>;

// A candidate successor variant, enriched with the edge validity and asserted facts the canon filter
// needs. validEdge is whether (from_beat_id, this) exists in beat_edges. asserts are the canon facts
// this variant claims, checked against the current beat's required canon_facts.
export type CanonCandidate = Candidate & {
  validEdge: boolean; // exists as a row in beat_edges from the current beat
  asserts?: CanonFacts; // facts this variant asserts; must not contradict required canon
};

export type CanonFilterResult = {
  arms: CanonCandidate[]; // the safe arm set the policy may rank
  rejected: CanonCandidate[]; // removed candidates, kept for explainability
  reason: string; // human-readable summary of what bounded the arm set
};

function contradictsCanon(asserts: CanonFacts | undefined, required: CanonFacts): boolean {
  if (!asserts) return false;
  for (const key of Object.keys(required)) {
    if (key in asserts && !Object.is(asserts[key], required[key])) return true;
  }
  return false;
}

// The hard filter. Removes any candidate that is not a valid beat_edges successor or that contradicts
// the current beat's canon_facts. This runs BEFORE any policy scoring; the bandit never sees a rejected
// arm, so it can never choose one.
export function canonFilter(candidates: CanonCandidate[], canonFacts: CanonFacts): CanonFilterResult {
  const arms: CanonCandidate[] = [];
  const rejected: CanonCandidate[] = [];
  for (const c of candidates) {
    if (!c.validEdge || contradictsCanon(c.asserts, canonFacts)) rejected.push(c);
    else arms.push(c);
  }
  const reason =
    `canon filter: ${arms.length} valid successor(s) of ${rejected.length + arms.length} candidate(s); ` +
    `${rejected.length} removed (invalid edge or canon_facts violation)`;
  return { arms, rejected, reason };
}
