// 25-D2 selection resolution (viewer side, pure). Given the experiment service's per-viewer pick and the
// viewer's accessibility preferences, decide which poster art to render and which posterId to log.
//
// HARD GATE: the ACCESSIBILITY-FIRST candidate is always present and always eligible. When the viewer has
// a relevant accessibility preference set (captions / audio description / sign turned on, which is the
// accessibility-first default), that variant is HONORED over the bandit pick. Otherwise the bandit
// selection stands. Creators never pick per-viewer art; the system selects. No em dashes.

import type { PosterSelection } from "../api/experiment.js";
import type { A11yPreferences } from "../a11y/preferences.js";

// A resolved poster ready to render: the url to show (may be null -> the caller's gradient/blank surface),
// the posterId to log against, the propensity to carry through, and whether the accessibility-first
// variant was honored (for logging / debugging, not a layout signal).
export interface ResolvedPoster {
  url: string | null;
  posterId: string;
  propensity?: number;
  honoredAccessibilityFirst: boolean;
}

// True when the viewer signals a relevant accessibility preference. Captions, audio description, and sign
// are accessibility-first defaults; any one of them being on means the accessibility-first poster variant
// should be honored when the creator's set provides one.
export function hasRelevantA11yPreference(prefs: A11yPreferences | undefined | null): boolean {
  if (!prefs) return false;
  return !!(prefs.captions || prefs.audioDescription || prefs.sign);
}

// Resolve the service selection against the viewer's a11y preferences. Returns null when there is nothing
// servable (no selection, or a selection with no usable poster id) so the caller falls back to the
// existing series.poster_url with no layout shift and no dead end.
export function resolvePosterSelection(
  selection: PosterSelection | null,
  prefs: A11yPreferences | undefined | null,
): ResolvedPoster | null {
  if (!selection || !selection.posterId) return null;

  // Honor the accessibility-first variant when the viewer needs it and the set carries one.
  if (hasRelevantA11yPreference(prefs)) {
    const a11yCandidate = selection.candidates?.find((c) => c.accessibilityFirst);
    if (a11yCandidate) {
      return {
        url: a11yCandidate.url,
        posterId: a11yCandidate.posterId,
        // The accessibility-first variant is a guaranteed-eligible choice, not a bandit draw, so it is
        // served deterministically (propensity 1) for this viewer. Logging stays propensity-weighted.
        propensity: 1,
        honoredAccessibilityFirst: true,
      };
    }
    // The bandit pick itself may already be the accessibility-first variant.
    if (selection.accessibilityFirst) {
      return {
        url: selection.url,
        posterId: selection.posterId,
        propensity: selection.propensity,
        honoredAccessibilityFirst: true,
      };
    }
  }

  // Otherwise the bandit selection stands.
  return {
    url: selection.url,
    posterId: selection.posterId,
    propensity: selection.propensity,
    honoredAccessibilityFirst: false,
  };
}
