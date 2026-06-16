// Unit test for accessibility defaults and resolution. Tracks are on by default and resolved against
// what the variant actually provides; a preferred track the cut lacks is reported as unavailable, not
// silently dropped. No em dashes.

import { describe, it, expect } from "vitest";
import { DEFAULT_A11Y, accessibilityFromVariant, resolveA11y } from "./preferences.js";
import type { VariantNode } from "../api/content.js";

// Minimal VariantNode builder; override only the track URL fields a case cares about.
function variant(over: Partial<VariantNode> = {}): VariantNode {
  return {
    id: "v1",
    beat_id: "b1",
    language: "en",
    intensity: 3,
    tier: "standard",
    is_premium: false,
    coin_cost: 0,
    playback_url: "http://media.test/master.m3u8",
    ...over,
  };
}

describe("a11y preferences", () => {
  it("defaults captions, audio description, and sign on", () => {
    expect(DEFAULT_A11Y.captions).toBe(true);
    expect(DEFAULT_A11Y.audioDescription).toBe(true);
    expect(DEFAULT_A11Y.sign).toBe(true);
  });

  it("activates only the tracks the variant provides", () => {
    const active = resolveA11y(DEFAULT_A11Y, { captions: true, audio_description: false, sign: false, languages: ["en"] });
    expect(active.captions).toBe(true);
    expect(active.audioDescription).toBe(false);
    expect(active.sign).toBe(false);
  });

  it("reports preferred tracks the cut does not carry as unavailable", () => {
    const active = resolveA11y(DEFAULT_A11Y, { captions: true, audio_description: false, sign: false });
    expect(active.unavailable).toContain("audioDescription");
    expect(active.unavailable).toContain("sign");
    expect(active.unavailable).not.toContain("captions");
  });

  it("falls back to an available language when the preferred one is absent", () => {
    const active = resolveA11y({ ...DEFAULT_A11Y, language: "fr" }, { languages: ["en", "es"] });
    expect(active.language).toBe("en");
  });
});

// Regression guard: track availability is derived from the PRESENCE of the variant's real track URLs, so
// a track can never silently vanish (and never be claimed without an asset). This locks the bug where the
// player rendered tracks from URL presence while the resolver read a separate flag object, letting them
// drift. No em dashes.
describe("accessibilityFromVariant (track availability from URLs)", () => {
  it("reports every track available when all track URLs are present", () => {
    const a = accessibilityFromVariant(
      variant({
        caption_doc_url: "http://media.test/captions.json",
        audio_description_url: "http://media.test/ad.json",
        sign_video_url: "http://media.test/asl_sign.webm",
        dub_audio_urls: { es: "http://media.test/es_dub.m4a", fr: "http://media.test/fr_dub.m4a" },
      }),
    );
    expect(a.captions).toBe(true);
    expect(a.audio_description).toBe(true);
    expect(a.sign).toBe(true);
    expect(a.languages).toEqual(["en", "es", "fr"]);
  });

  it("reports a track unavailable exactly when its URL is absent", () => {
    expect(accessibilityFromVariant(variant({ caption_doc_url: "x" })).captions).toBe(true);
    expect(accessibilityFromVariant(variant({})).captions).toBe(false);
    expect(accessibilityFromVariant(variant({ audio_description_url: "x" })).audio_description).toBe(true);
    expect(accessibilityFromVariant(variant({})).audio_description).toBe(false);
    expect(accessibilityFromVariant(variant({ sign_video_url: "x" })).sign).toBe(true);
    expect(accessibilityFromVariant(variant({})).sign).toBe(false);
  });

  it("languages default to the base language alone when there are no dubs", () => {
    expect(accessibilityFromVariant(variant({ language: "pt" })).languages).toEqual(["pt"]);
  });

  it("treats a missing variant as carrying nothing", () => {
    const a = accessibilityFromVariant(undefined);
    expect(a).toEqual({ captions: false, audio_description: false, sign: false, languages: [] });
  });

  it("a variant with no tracks surfaces all preferred tracks as unavailable, never silently hidden", () => {
    const active = resolveA11y(DEFAULT_A11Y, accessibilityFromVariant(variant({})));
    expect(active.captions).toBe(false);
    expect(active.audioDescription).toBe(false);
    expect(active.sign).toBe(false);
    expect(active.unavailable).toEqual(
      expect.arrayContaining(["captions", "audioDescription", "sign"]),
    );
  });

  it("a fully tracked variant activates every default-on track", () => {
    const active = resolveA11y(
      DEFAULT_A11Y,
      accessibilityFromVariant(
        variant({
          caption_doc_url: "c",
          audio_description_url: "a",
          sign_video_url: "s",
        }),
      ),
    );
    expect(active.captions).toBe(true);
    expect(active.audioDescription).toBe(true);
    expect(active.sign).toBe(true);
    expect(active.unavailable).toEqual([]);
  });
});
