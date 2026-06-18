// Recap engine core ("Previously in your cut"). Ported from the reference implementation documented in
// docs/product/design/DESIGN_HANDOFF_README.md (Recap engine section). This is the ONE piece of real
// reference logic from the design bundle; everything else in that bundle is presentational.
//
// CRITICAL invariant from the handoff: the recap SELECTS cached beat variants, it never renders per
// viewer live. assembleRecap is a pure function over (viewer_state, cached variant pool); given the same
// inputs it returns the same recap, with no I/O, no clock, no randomness. The HTTP layer reads the inputs
// from the hosted mobile schema and emits events; this file does neither. No em dashes.

// Inputs (per viewer), derived upstream from viewer_state + decision_log + events. The HTTP adapter maps
// the persisted rows into this shape before calling assembleRecap.
export interface ViewerState {
  // The viewer's point-of-view track. Variants tagged with a different pov (and not "any") are filtered out.
  pov: string;
  // Caption localization key, for example "en" or "es". Selects which entry of a variant's captions map is
  // surfaced as the recap caption.
  language: string;
  // The character this viewer favors. Used to break sort ties (favorite beats sort first within an order
  // group) and to flag beats in the output.
  favoriteCharacter: string;
  // The ordered list of beat ids the viewer actually traversed (their branch). Only variants whose beat is
  // on this path are eligible.
  branchPath: string[];
  // Beat ids the viewer skipped. Eligible variants on a skipped beat are dropped.
  skippedScenes: string[];
  // The most recent beat the viewer reached. Carried for context/telemetry; not a filter input.
  lastBeat: string;
}

// A cached beat variant from the variant substrate. The recap picks from these; it does not synthesize
// them. captions is a language map; localization reads captions[language] with an English fallback.
export interface BeatVariant {
  id: string;
  beat: string;
  // Chronological position of the beat within the series. Lower comes earlier. Drives the recap ordering.
  order: number;
  // The pov this variant is cut for. "any" matches every viewer pov.
  pov: string;
  character: string;
  thumb: string;
  // Localized captions keyed by language code, for example { en: "...", es: "..." }.
  captions: Record<string, string>;
}

// One assembled recap beat: the selected variant projected to the viewer's language, with the
// favorite-character flag resolved. caption is already localized so the client renders it verbatim.
export interface RecapBeat {
  variantId: string;
  beat: string;
  order: number;
  pov: string;
  character: string;
  thumb: string;
  caption: string;
  language: string;
  isFavoriteCharacter: boolean;
}

export interface Recap {
  beats: RecapBeat[];
  // Convenience projections for the recap_shown event (beat count + variant ids), so the caller does not
  // re-derive them from beats.
  variantIds: string[];
  beatCount: number;
}

// How many beats the recap surfaces. The handoff specifies the last 3 beats.
export const RECAP_BEAT_LIMIT = 3;

// Localize a variant caption by language, falling back to English then to any available caption, so a
// missing localization never produces an empty recap line. Pure.
function localizeCaption(captions: Record<string, string>, language: string): string {
  if (typeof captions[language] === "string" && captions[language].length > 0) {
    return captions[language];
  }
  if (typeof captions.en === "string" && captions.en.length > 0) {
    return captions.en;
  }
  const first = Object.values(captions).find((v) => typeof v === "string" && v.length > 0);
  return first ?? "";
}

// assembleRecap(state, pool): the ported reference algorithm, step for step from the handoff:
//   1. filter pool to beats on branchPath, matching the viewer's pov (or pov "any"),
//   2. drop skippedScenes,
//   3. sort chronologically with favoriteCharacter prioritized within ties,
//   4. take the LAST 3 beats,
//   5. localize caption by language, flag favorite-character beats.
// Pure: no I/O, deterministic for fixed inputs. Selects cached variants; renders nothing.
export function assembleRecap(state: ViewerState, pool: readonly BeatVariant[]): Recap {
  const onBranch = new Set(state.branchPath);
  const skipped = new Set(state.skippedScenes);

  // Step 1 + 2: eligibility. A variant is eligible when its beat is on the viewer's branch, its pov matches
  // the viewer (or is the universal "any"), and its beat was not skipped.
  const eligible = pool.filter((v) => {
    if (!onBranch.has(v.beat)) return false;
    if (v.pov !== state.pov && v.pov !== "any") return false;
    if (skipped.has(v.beat)) return false;
    return true;
  });

  // Step 3: chronological sort, with the favorite character winning ties at the same order. A stable
  // secondary key (variant id) keeps the result deterministic when two non-favorite variants share an order.
  const sorted = [...eligible].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const aFav = a.character === state.favoriteCharacter ? 0 : 1;
    const bFav = b.character === state.favoriteCharacter ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Step 4: the last RECAP_BEAT_LIMIT beats (chronological tail), preserving order.
  const tail = sorted.slice(Math.max(0, sorted.length - RECAP_BEAT_LIMIT));

  // Step 5: localize and flag.
  const beats: RecapBeat[] = tail.map((v) => ({
    variantId: v.id,
    beat: v.beat,
    order: v.order,
    pov: v.pov,
    character: v.character,
    thumb: v.thumb,
    caption: localizeCaption(v.captions, state.language),
    language: state.language,
    isFavoriteCharacter: v.character === state.favoriteCharacter,
  }));

  return {
    beats,
    variantIds: beats.map((b) => b.variantId),
    beatCount: beats.length,
  };
}
