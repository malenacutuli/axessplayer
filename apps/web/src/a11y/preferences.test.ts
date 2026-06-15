// Unit test for accessibility defaults and resolution. Tracks are on by default and resolved against
// what the variant actually provides; a preferred track the cut lacks is reported as unavailable, not
// silently dropped. No em dashes.

import { describe, it, expect } from "vitest";
import { DEFAULT_A11Y, resolveA11y } from "./preferences.js";

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
