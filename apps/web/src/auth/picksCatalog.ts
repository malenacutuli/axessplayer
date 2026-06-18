// PLACEHOLDER catalog for the "What do you love?" onboarding grid. These are channel/trope ids the viewer
// can pick (3 or more) at profile creation; each selection becomes a channel_follow via POST /profile and
// seeds a neutral, DRAFT cold-start preference vector (see services/identity/src/picks.ts). The ids are a
// marked placeholder set, NOT a signed-off taxonomy: a real catalog endpoint (services/catalog) replaces
// this. The weighting is uniform/neutral by the REWARD_WEIGHTS gate. No em dashes.

export interface PickOption {
  id: string;
  label: string;
  kind: "channel" | "trope";
}

// Marked PLACEHOLDER. Replace with a catalog-served list once the channels/tropes endpoint exists.
export const PICK_CATALOG: readonly PickOption[] = [
  { id: "ch_drama", label: "Drama", kind: "channel" },
  { id: "ch_thriller", label: "Thriller", kind: "channel" },
  { id: "ch_romance", label: "Romance", kind: "channel" },
  { id: "ch_comedy", label: "Comedy", kind: "channel" },
  { id: "ch_scifi", label: "Sci-fi", kind: "channel" },
  { id: "ch_documentary", label: "Documentary", kind: "channel" },
  { id: "tr_slow_burn", label: "Slow burn", kind: "trope" },
  { id: "tr_found_family", label: "Found family", kind: "trope" },
  { id: "tr_heist", label: "Heist", kind: "trope" },
  { id: "tr_redemption", label: "Redemption arc", kind: "trope" },
  { id: "tr_enemies_to_allies", label: "Enemies to allies", kind: "trope" },
  { id: "tr_underdog", label: "Underdog", kind: "trope" },
];

// Minimum picks required before a profile can be created (INTERACTION_MAP "pick 3 or more").
export const MIN_PICKS = 3;
