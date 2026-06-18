// 25-D2 selection resolution tests. The accessibility-first variant is honored when the viewer has a
// relevant accessibility preference; otherwise the bandit selection stands. A null/empty selection
// resolves to null so the caller falls back to the existing poster. No em dashes.

import { describe, it, expect } from "vitest";
import { resolvePosterSelection, hasRelevantA11yPreference } from "./posterSelection.js";
import { DEFAULT_A11Y, type A11yPreferences } from "../a11y/preferences.js";

const NO_A11Y: A11yPreferences = {
  captions: false,
  audioDescription: false,
  sign: false,
  captionColor: false,
  language: "en",
  signLanguage: "ASL",
};

describe("hasRelevantA11yPreference", () => {
  it("is true by default (accessibility-first defaults turn the tracks on)", () => {
    expect(hasRelevantA11yPreference(DEFAULT_A11Y)).toBe(true);
  });
  it("is false when captions, audio description, and sign are all off", () => {
    expect(hasRelevantA11yPreference(NO_A11Y)).toBe(false);
  });
});

describe("resolvePosterSelection", () => {
  it("returns null for a null selection (fall back to the existing poster)", () => {
    expect(resolvePosterSelection(null, DEFAULT_A11Y)).toBeNull();
  });

  it("lets the bandit selection stand when the viewer has no relevant a11y preference", () => {
    const r = resolvePosterSelection(
      { posterId: "bandit", url: "http://cdn/b.png", propensity: 0.3, candidates: [{ posterId: "a11y", url: "http://cdn/a.png", accessibilityFirst: true }] },
      NO_A11Y,
    );
    expect(r).toEqual({ url: "http://cdn/b.png", posterId: "bandit", propensity: 0.3, honoredAccessibilityFirst: false });
  });

  it("honors the accessibility-first candidate when the viewer needs it", () => {
    const r = resolvePosterSelection(
      { posterId: "bandit", url: "http://cdn/b.png", propensity: 0.3, candidates: [{ posterId: "a11y", url: "http://cdn/a.png", accessibilityFirst: true }] },
      DEFAULT_A11Y,
    );
    expect(r).toEqual({ url: "http://cdn/a.png", posterId: "a11y", propensity: 1, honoredAccessibilityFirst: true });
  });

  it("keeps the bandit pick when it is itself the accessibility-first variant", () => {
    const r = resolvePosterSelection(
      { posterId: "p", url: "http://cdn/p.png", propensity: 0.7, accessibilityFirst: true },
      DEFAULT_A11Y,
    );
    expect(r).toEqual({ url: "http://cdn/p.png", posterId: "p", propensity: 0.7, honoredAccessibilityFirst: true });
  });

  it("falls back to the bandit pick when the set carries no accessibility-first candidate", () => {
    const r = resolvePosterSelection(
      { posterId: "bandit", url: "http://cdn/b.png", propensity: 0.5, candidates: [{ posterId: "x", url: "http://cdn/x.png" }] },
      DEFAULT_A11Y,
    );
    expect(r?.posterId).toBe("bandit");
    expect(r?.honoredAccessibilityFirst).toBe(false);
  });
});
