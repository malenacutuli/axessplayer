// Accessibility-first defaults. Captions, audio description, sign, and language are ON by default
// wherever the playing variant provides them (brief design 4). Preferences persist per device so a
// viewer who turns a track off stays off. The resolver intersects the viewer's preference with what
// the variant actually offers, so we never claim a track the cut does not carry. No em dashes.

import type { VariantAccessibility, VariantNode } from "../api/content.js";

export interface A11yPreferences {
  captions: boolean;
  audioDescription: boolean;
  sign: boolean;
  // Preferred language code, for example "en". Falls back to the variant language when unavailable.
  language: string;
  // Preferred sign language short name (ASL, PSL, ...). Falls back to the first one the title provides.
  signLanguage: string;
}

// Accessibility-first: everything the viewer might need is on by default.
export const DEFAULT_A11Y: A11yPreferences = {
  captions: true,
  audioDescription: true,
  sign: true,
  language: "en",
  signLanguage: "ASL",
};

// What is actually active for a given variant: the viewer's preference AND the variant's offering.
export interface ActiveA11y {
  captions: boolean;
  audioDescription: boolean;
  sign: boolean;
  language: string;
  // Tracks the viewer wants but this cut does not carry, surfaced so the UI can explain the gap.
  unavailable: Array<"captions" | "audioDescription" | "sign">;
}

export function resolveA11y(
  prefs: A11yPreferences,
  available: VariantAccessibility | undefined,
): ActiveA11y {
  const a = available ?? {};
  const unavailable: ActiveA11y["unavailable"] = [];
  if (prefs.captions && !a.captions) unavailable.push("captions");
  if (prefs.audioDescription && !a.audio_description) unavailable.push("audioDescription");
  if (prefs.sign && !a.sign) unavailable.push("sign");

  const languages = a.languages ?? [];
  const language = languages.includes(prefs.language)
    ? prefs.language
    : languages[0] ?? prefs.language;

  return {
    captions: prefs.captions && !!a.captions,
    audioDescription: prefs.audioDescription && !!a.audio_description,
    sign: prefs.sign && !!a.sign,
    language,
    unavailable,
  };
}

// Derive a variant's accessibility offering from the PRESENCE of its real track URLs (0009a), not from a
// separate flag object. URL presence is the single source of truth: the player renders a track only when
// its asset URL exists, so availability computed this way can never disagree with what actually plays, and
// no track can silently vanish when a flag and a URL drift apart. Languages are the base language plus any
// language present in the dub audio map. No em dashes.
export function accessibilityFromVariant(variant: VariantNode | undefined | null): VariantAccessibility {
  if (!variant) return { captions: false, audio_description: false, sign: false, languages: [] };
  const languages = Array.from(
    new Set([variant.language ?? "en", ...Object.keys(variant.dub_audio_urls ?? {})]),
  );
  return {
    captions: !!variant.caption_doc_url,
    audio_description: !!variant.audio_description_url,
    sign: !!variant.sign_video_url,
    languages,
  };
}

const STORAGE_KEY = "axessplayer.a11y";

export function loadA11yPreferences(storage?: Pick<Storage, "getItem">): A11yPreferences {
  const store = storage ?? safeLocalStorage();
  if (!store) return { ...DEFAULT_A11Y };
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_A11Y };
    return { ...DEFAULT_A11Y, ...(JSON.parse(raw) as Partial<A11yPreferences>) };
  } catch {
    return { ...DEFAULT_A11Y };
  }
}

export function saveA11yPreferences(
  prefs: A11yPreferences,
  storage?: Pick<Storage, "setItem">,
): void {
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best effort: a full or unavailable storage must not break playback.
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
