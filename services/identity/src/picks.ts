// Onboarding picks: the channel/genre interest chips a viewer selects when creating a profile (per
// INTERACTION_MAP "Create profile, channel picks"). They do two things, both pure here:
//   1. seed each pick as a channel_follow (writes happen in the DB port), and
//   2. seed a neutral preference_vector for the viewer keyed by pick.
//
// GATE: REWARD_WEIGHTS_SIGNED_OFF=false. The seeded vector is DRAFT/neutral, display-and-cold-start only.
// Every selected pick gets the SAME neutral weight; this is NOT an optimized or revenue/extraction
// objective and must not be treated as one. The decision engine may later learn real weights; this is just
// a uniform cold-start prior. No em dashes.

export const NEUTRAL_PICK_WEIGHT = 1;

export interface Pick {
  // A channel/genre id the viewer chose. Free-form id from the catalog; validated only for shape here.
  channelId: string;
}

// Coerce the request body's picks[] into clean Pick values: keep entries with a non-empty string
// channelId, dedupe, preserve order. Tolerates {channelId} objects or bare id strings.
export function normalizePicks(raw: unknown): Pick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const entry of raw) {
    let id: unknown;
    if (typeof entry === "string") id = entry;
    else if (entry != null && typeof entry === "object") id = (entry as Record<string, unknown>).channelId;
    if (typeof id !== "string") continue;
    const channelId = id.trim();
    if (channelId.length === 0 || seen.has(channelId)) continue;
    seen.add(channelId);
    out.push({ channelId });
  }
  return out;
}

// Build the neutral, DRAFT cold-start preference vector from the picks: each pick contributes the same
// neutral weight. Display/cold-start only; not a signed-off reward objective.
export function seedVectorFromPicks(picks: readonly Pick[]): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const p of picks) vector[p.channelId] = NEUTRAL_PICK_WEIGHT;
  return vector;
}
