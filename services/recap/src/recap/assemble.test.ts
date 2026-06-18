// Unit test for the recap engine (node:test). Proves the handoff acceptance criterion: two viewers with
// different histories produce visibly different recaps (different beats, captions, language, and branch
// beats) reflecting their actual choices. Pure: no DB, no network. No em dashes.

import test from "node:test";
import assert from "node:assert/strict";
import { assembleRecap, RECAP_BEAT_LIMIT, type BeatVariant, type ViewerState } from "./assemble.js";

// A shared cached variant pool spanning two povs, two languages of captions, several beats, and an "any"
// pov beat that both viewers can see. order encodes chronology.
const pool: BeatVariant[] = [
  { id: "v-b1-mia", beat: "b1", order: 1, pov: "mia", character: "Mia", thumb: "t1.png", captions: { en: "Mia opens the vault", es: "Mia abre la boveda" } },
  { id: "v-b1-leo", beat: "b1", order: 1, pov: "leo", character: "Leo", thumb: "t1l.png", captions: { en: "Leo opens the vault", es: "Leo abre la boveda" } },
  { id: "v-b2-any", beat: "b2", order: 2, pov: "any", character: "Narrator", thumb: "t2.png", captions: { en: "The alarm sounds", es: "Suena la alarma" } },
  { id: "v-b3-mia", beat: "b3", order: 3, pov: "mia", character: "Mia", thumb: "t3.png", captions: { en: "Mia runs", es: "Mia corre" } },
  { id: "v-b3-leo", beat: "b3", order: 3, pov: "leo", character: "Leo", thumb: "t3l.png", captions: { en: "Leo runs", es: "Leo corre" } },
  { id: "v-b4-mia", beat: "b4", order: 4, pov: "mia", character: "Mia", thumb: "t4.png", captions: { en: "Mia escapes", es: "Mia escapa" } },
  { id: "v-b4-leo", beat: "b4", order: 4, pov: "leo", character: "Leo", thumb: "t4l.png", captions: { en: "Leo escapes", es: "Leo escapa" } },
  { id: "v-b5-mia", beat: "b5", order: 5, pov: "mia", character: "Mia", thumb: "t5.png", captions: { en: "Mia hides", es: "Mia se esconde" } },
];

// Viewer A: Mia pov, English, branched b1->b2->b3->b4->b5, skipped nothing.
const viewerA: ViewerState = {
  pov: "mia",
  language: "en",
  favoriteCharacter: "Mia",
  branchPath: ["b1", "b2", "b3", "b4", "b5"],
  skippedScenes: [],
  lastBeat: "b5",
};

// Viewer B: Leo pov, Spanish, branched b1->b2->b3->b4 (no b5), skipped b2.
const viewerB: ViewerState = {
  pov: "leo",
  language: "es",
  favoriteCharacter: "Leo",
  branchPath: ["b1", "b2", "b3", "b4"],
  skippedScenes: ["b2"],
  lastBeat: "b4",
};

test("takes the last 3 beats in chronological order", () => {
  const recap = assembleRecap(viewerA, pool);
  assert.equal(recap.beatCount, RECAP_BEAT_LIMIT);
  assert.deepEqual(
    recap.beats.map((b) => b.beat),
    ["b3", "b4", "b5"],
  );
  // Strictly increasing order.
  for (let i = 1; i < recap.beats.length; i++) {
    assert.ok(recap.beats[i].order > recap.beats[i - 1].order);
  }
});

test("filters to the viewer pov (or any) and selects cached variants", () => {
  const recap = assembleRecap(viewerA, pool);
  // Every selected variant is either the viewer's pov or the universal "any".
  for (const b of recap.beats) {
    assert.ok(b.pov === "mia" || b.pov === "any");
  }
  // variantIds are the cached ids, not synthesized.
  assert.deepEqual(recap.variantIds, recap.beats.map((b) => b.variantId));
});

test("drops skipped scenes", () => {
  const recap = assembleRecap(viewerB, pool);
  assert.ok(!recap.beats.some((b) => b.beat === "b2"), "skipped beat b2 must not appear");
});

test("localizes captions and flags the favorite character", () => {
  const a = assembleRecap(viewerA, pool);
  const b = assembleRecap(viewerB, pool);
  // English vs Spanish localization.
  assert.ok(a.beats.every((x) => x.language === "en"));
  assert.ok(b.beats.every((x) => x.language === "es"));
  assert.ok(a.beats.some((x) => x.caption === "Mia runs"));
  assert.ok(b.beats.some((x) => x.caption === "Leo corre"));
  // Favorite character flag tracks the viewer.
  assert.ok(a.beats.some((x) => x.character === "Mia" && x.isFavoriteCharacter));
  assert.ok(b.beats.some((x) => x.character === "Leo" && x.isFavoriteCharacter));
});

test("two different viewer histories produce visibly different recaps (acceptance)", () => {
  const a = assembleRecap(viewerA, pool);
  const b = assembleRecap(viewerB, pool);

  // Different branch beats: A ends on b5, B does not reach b5 and skipped b2.
  const beatsA = a.beats.map((x) => x.beat);
  const beatsB = b.beats.map((x) => x.beat);
  assert.notDeepEqual(beatsA, beatsB);
  assert.ok(beatsA.includes("b5"));
  assert.ok(!beatsB.includes("b5"));

  // Different thumbs (Mia pov cuts vs Leo pov cuts).
  const thumbsA = new Set(a.beats.map((x) => x.thumb));
  const thumbsB = new Set(b.beats.map((x) => x.thumb));
  const overlap = [...thumbsA].filter((t) => thumbsB.has(t));
  assert.equal(overlap.length, 0, "Mia-pov and Leo-pov recaps must not share thumbs");

  // Different captions (different language AND different pov text).
  assert.notDeepEqual(
    a.beats.map((x) => x.caption),
    b.beats.map((x) => x.caption),
  );

  // Different variant ids selected.
  assert.notDeepEqual(a.variantIds, b.variantIds);
});

test("favorite character wins ties within the same chronological order", () => {
  // Two variants share order 9; the favorite-character one must sort first.
  const tiePool: BeatVariant[] = [
    { id: "z-other", beat: "bz", order: 9, pov: "any", character: "Other", thumb: "z.png", captions: { en: "other" } },
    { id: "a-fav", beat: "bz2", order: 9, pov: "any", character: "Mia", thumb: "z2.png", captions: { en: "fav" } },
  ];
  const state: ViewerState = {
    pov: "mia",
    language: "en",
    favoriteCharacter: "Mia",
    branchPath: ["bz", "bz2"],
    skippedScenes: [],
    lastBeat: "bz2",
  };
  const recap = assembleRecap(state, tiePool);
  assert.equal(recap.beats[0].character, "Mia", "favorite character sorts first within an order tie");
});
