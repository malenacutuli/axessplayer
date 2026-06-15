// Accessibility selection tests: a11y is ON by default; the variant that provides the most requested
// affordances (and a matching language) is selected; turning an affordance off does not penalize a
// variant; activeAccessibility reflects only what is both requested and provided. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeAccessibility,
  defaultPreferences,
  selectVariant,
  scoreVariant,
} from "./preferences.js";
import type { BeatNode } from "../feed/graph.js";

const beat: BeatNode = {
  id: "beat",
  variants: [
    { id: "plain-en", language: "en", captions: false },
    { id: "full-es", language: "es", captions: true, audioDescription: true, sign: true },
  ],
};

test("defaults turn captions, audio description, and sign ON", () => {
  const p = defaultPreferences();
  assert.equal(p.captions, true);
  assert.equal(p.audioDescription, true);
  assert.equal(p.sign, true);
});

test("by default selects the variant providing the most accessibility affordances", () => {
  const chosen = selectVariant(beat, defaultPreferences());
  assert.equal(chosen?.id, "full-es");
});

test("language preference dominates: an en preference selects the en cut even with fewer a11y tracks", () => {
  const chosen = selectVariant(beat, { ...defaultPreferences(), language: "en" });
  assert.equal(chosen?.id, "plain-en");
});

test("turning every a11y affordance off does not penalize a variant that has them (tie -> first)", () => {
  const prefs = { captions: false, audioDescription: false, sign: false } as const;
  assert.equal(scoreVariant(beat.variants[0], prefs), 0);
  assert.equal(scoreVariant(beat.variants[1], prefs), 0);
  // Tie resolves to the first in graph order.
  assert.equal(selectVariant(beat, prefs)?.id, "plain-en");
});

test("activeAccessibility reflects only what is both requested and provided, on by default", () => {
  const active = activeAccessibility(beat.variants[1], defaultPreferences());
  assert.deepEqual(active, {
    captions: true,
    audioDescription: true,
    sign: true,
    language: "es",
  });
});

test("activeAccessibility hides an affordance the viewer turned off even if the variant provides it", () => {
  const active = activeAccessibility(beat.variants[1], {
    captions: false,
    audioDescription: true,
    sign: true,
  });
  assert.equal(active.captions, false);
  assert.equal(active.sign, true);
});
