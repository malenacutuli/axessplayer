// 25-D2 dynamic-poster candidate model for the ONLINE experiment serving tier (Slice A). A poster SET
// belongs to a series: each candidate is a poster image tagged by emotion / character / language, plus the
// load-bearing accessibilityFirst pin. The decision plane serves ONE candidate per viewer from this set,
// chosen by learned CTR on the existing epsilon-greedy bandit (bandit-core.ts). Pure module: no node:http,
// no pg, no clock, no global RNG. Determinism comes from the injected bandit RNG seed.
//
// HARD GATE (founder sign-off, 25-D2): the bandit optimizes CTR for SELECTION only, a presentation choice.
// REWARD_WEIGHTS_SIGNED_OFF stays false, so while unsigned the exploit branch is reward-insensitive and no
// CTR/wellbeing/revenue number can move the choice. The ACCESSIBILITY-FIRST candidate is ALWAYS in the
// eligible set and is the guaranteed fallback. Creators NEVER pick the per-viewer art; the system selects.
// No em dashes.

import { type Arm } from "./bandit-core.js";

// One poster candidate in a series' SET. posterId is stable per candidate; url is the served image. The
// tags (emotion / character / language) describe the candidate so a viewer taste profile can prefer it
// once the bandit is signed; while unsigned they are descriptive only. accessibilityFirst pins the
// accessibility-first variant, which is ALWAYS eligible and the guaranteed fallback.
export type PosterCandidate = {
  posterId: string;
  url: string;
  emotion: string | null;
  character: string | null;
  language: string | null;
  accessibilityFirst: boolean;
};

// A resolved poster SET for a series, plus the provenance of where it came from. source distinguishes the
// honest states so a caller (and a dashboard) can tell a real candidate table apart from a fallback:
//   "candidates" the additive mobile.poster_candidates table is applied and returned this set.
//   "fallback"   the table is applied/queryable but the series has no candidates, so we synthesize a single
//                accessibility-first candidate from the series poster_url (never fabricated tags).
//   "unwired"    the candidate table is NOT applied yet; the set is empty. NEVER fabricated.
export type PosterSetSource = "candidates" | "fallback" | "unwired";

export type PosterSet = {
  seriesId: string;
  candidates: PosterCandidate[];
  source: PosterSetSource;
};

// The accessibility-first arm-id convention shared with the bandit core / HTTP layer: an arm id prefixed
// "a11y:" is pinned alwaysEligible so it can never be filtered out of a poster set. We namespace the
// candidate's posterId into an arm id so the SAME posterId in two different series never collides in the
// CTR store, and so the accessibility-first candidate gets the always-eligible pin by construction.
export function posterArmId(seriesId: string, candidate: PosterCandidate): string {
  const base = `${seriesId}:${candidate.posterId}`;
  return candidate.accessibilityFirst ? `a11y:${base}` : base;
}

// Inverse of posterArmId: recover the posterId from a chosen arm id, given the series. Used to map the
// bandit's chosen arm back to the candidate the caller serves. Returns null if the arm id does not belong
// to this series (defensive; the caller built the arms from this series' set).
export function posterIdFromArm(seriesId: string, armId: string): string | null {
  const a11y = `a11y:${seriesId}:`;
  if (armId.startsWith(a11y)) return armId.slice(a11y.length);
  const plain = `${seriesId}:`;
  if (armId.startsWith(plain)) return armId.slice(plain.length);
  return null;
}

// Build the bandit arm set for a poster SET. Each candidate becomes an arm; the accessibility-first
// candidate is pinned alwaysEligible so eligibleArms() can never drop it. rewardEstimate is supplied by the
// caller from the CTR store (gated downstream: ignored while unsigned). statsFor maps a candidate to its
// measured reward; a candidate with no logged impressions reads as the neutral smoothed prior.
export function candidateArms(
  set: PosterSet,
  rewardFor: (armId: string) => number
): Arm[] {
  return set.candidates.map((c) => {
    const id = posterArmId(set.seriesId, c);
    return {
      id,
      rewardEstimate: rewardFor(id),
      eligible: true,
      ...(c.accessibilityFirst ? { alwaysEligible: true } : {}),
    };
  });
}

// Synthesize a single accessibility-first candidate from a series poster_url. This is the documented
// fallback when a series has NO candidate rows: until a creator uploads a poster SET, the selection serves
// the one series poster, treated as the accessibility-first (always-eligible) variant. Tags are null
// (never fabricated). posterId is a stable derived id so impression/CTR logging keys consistently.
export function fallbackCandidate(seriesId: string, posterUrl: string): PosterCandidate {
  return {
    posterId: "series-default",
    url: posterUrl,
    emotion: null,
    character: null,
    language: null,
    accessibilityFirst: true,
  };
}

// The candidate store boundary. resolve() returns the poster SET for a series. The shipped store is the
// UNWIRED store (below): the additive table is not applied, so it returns an empty set with source
// "unwired" (and the router falls back to the single series poster_url). A pg-backed store reads
// mobile.poster_candidates once 09_poster_candidates.sql is applied, returning source "candidates".
export interface PosterCandidateStore {
  resolve(seriesId: string): Promise<PosterSet>;
}

// The shipped store. The additive mobile.poster_candidates table is NOT applied yet, so there is no honest
// source of candidates: this returns an empty set with source "unwired". It NEVER fabricates candidates.
// The router treats an unwired/empty set as the signal to fall back to the single series poster_url.
export class UnwiredPosterCandidateStore implements PosterCandidateStore {
  async resolve(seriesId: string): Promise<PosterSet> {
    return { seriesId, candidates: [], source: "unwired" };
  }
}

// An in-memory candidate store for tests and local wiring. Real shape, process-local, FLAGGED. Lets a test
// seed a series with a tagged candidate SET and assert selection over it without a database. Production
// swaps this for the pg-backed store reading mobile.poster_candidates (source "candidates").
export class InMemoryPosterCandidateStore implements PosterCandidateStore {
  private readonly bySeries = new Map<string, PosterCandidate[]>();

  set(seriesId: string, candidates: PosterCandidate[]): void {
    this.bySeries.set(seriesId, candidates);
  }

  async resolve(seriesId: string): Promise<PosterSet> {
    const candidates = this.bySeries.get(seriesId);
    if (candidates == null) return { seriesId, candidates: [], source: "unwired" };
    return { seriesId, candidates: [...candidates], source: "candidates" };
  }
}
