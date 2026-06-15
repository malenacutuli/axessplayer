// Accessibility-first preferences and variant selection. The brief: captions, audio description, sign,
// and language are SELECTABLE and ON BY DEFAULT where the variant provides them. This module holds the
// viewer's a11y preferences and resolves, for a given beat, which variant best satisfies them. The
// player screen uses the resolved variant id as its starting cut; the adaptive switch (player-sdk) then
// keeps the same a11y intent on subsequent cuts where the graph offers it. No em dashes.

import type { BeatNode, VariantNode } from "../feed/graph.js";

// The viewer's accessibility preferences. The DEFAULT is "on where provided": every accessibility
// affordance is requested, and a variant gets credit for each one it actually provides. A viewer can
// turn any off; language is a positive preference (a tag), undefined meaning "no language preference".
export interface AccessibilityPreferences {
  captions: boolean;
  audioDescription: boolean;
  sign: boolean;
  language?: string;
}

// The default preferences: accessibility ON by default. Language is left unset so the device/app locale
// (or the series' base language) decides until the viewer picks one.
export function defaultPreferences(language?: string): AccessibilityPreferences {
  return { captions: true, audioDescription: true, sign: true, language };
}

// Score a variant against the preferences. Higher is better. A requested affordance the variant provides
// scores +1; a language match scores a strong bonus so language dominates ties (a viewer's spoken
// language matters more than any single a11y toggle). Affordances NOT requested are ignored (not
// penalized): turning captions off must not down-rank a variant that happens to have them.
export function scoreVariant(
  variant: VariantNode,
  prefs: AccessibilityPreferences
): number {
  let score = 0;
  if (prefs.captions && variant.captions) score += 1;
  if (prefs.audioDescription && variant.audioDescription) score += 1;
  if (prefs.sign && variant.sign) score += 1;
  if (prefs.language && variant.language === prefs.language) score += 5;
  return score;
}

// Pick the best variant on a beat for the preferences. Deterministic: among equal scores, the FIRST in
// graph order wins (the content author's default ordering). Returns undefined for a beat with no
// variants. A premium variant is NOT excluded here: gating is the paywall's job (src/wallet), so the
// player can present the locked premium cut and offer to unlock it.
export function selectVariant(
  beat: BeatNode,
  prefs: AccessibilityPreferences
): VariantNode | undefined {
  let best: VariantNode | undefined;
  let bestScore = -Infinity;
  for (const v of beat.variants) {
    const s = scoreVariant(v, prefs);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

// The accessibility affordances that are BOTH requested and provided by the chosen variant: what the
// player should actually render as ON (caption track shown, AD audio mixed, sign overlay visible). This
// is what "on by default where the variant provides them" resolves to at play time.
export interface ActiveAccessibility {
  captions: boolean;
  audioDescription: boolean;
  sign: boolean;
  language?: string;
}

export function activeAccessibility(
  variant: VariantNode,
  prefs: AccessibilityPreferences
): ActiveAccessibility {
  return {
    captions: prefs.captions && variant.captions === true,
    audioDescription: prefs.audioDescription && variant.audioDescription === true,
    sign: prefs.sign && variant.sign === true,
    language: variant.language ?? prefs.language,
  };
}
