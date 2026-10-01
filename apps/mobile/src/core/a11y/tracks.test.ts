import { test } from "node:test";
import assert from "node:assert/strict";
import { badgesFor, durationLabel, formatDuration, pickSubtitleTrack, sameTrack, sponsorDisclosure } from "./tracks";

const tracks = [
  { id: "1", language: "en", label: "English" },
  { id: "2", language: "es-419", label: "Spanish (Latin America)" },
  { id: "3", language: "fr", label: "French" },
];

test("captions off selects nothing", () => {
  assert.equal(pickSubtitleTrack(tracks, false, ["en"]), null);
  assert.equal(pickSubtitleTrack([], true, ["en"]), null);
});

test("exact language, then base language, then video language, then first", () => {
  assert.equal(pickSubtitleTrack(tracks, true, ["fr"])?.id, "3");
  assert.equal(pickSubtitleTrack(tracks, true, ["es-ES"])?.id, "2");
  assert.equal(pickSubtitleTrack(tracks, true, ["de"], "fr")?.id, "3");
  assert.equal(pickSubtitleTrack(tracks, true, ["de"])?.id, "1");
});

test("sameTrack compares by id, else language+label", () => {
  assert.equal(sameTrack(tracks[0], { id: "1", language: "x", label: "y" }), true);
  assert.equal(sameTrack({ language: "en", label: "E" }, { language: "en", label: "E" }), true);
  assert.equal(sameTrack(null, null), true);
  assert.equal(sameTrack(tracks[0], null), false);
});

test("badges describe each accessibility feature", () => {
  const b = badgesFor({ captions: true, audio_description: true, sign: true, dubs: ["es", "pt"] });
  assert.deepEqual(b.map((x) => x.key), ["captions", "audio_description", "sign", "dubs"]);
  assert.match(b[3].label, /^Dubbed in /);
  assert.deepEqual(badgesFor({ captions: false, audio_description: false, sign: false, dubs: [] }), []);
});

test("sponsor disclosure is explicit and labeled", () => {
  assert.equal(sponsorDisclosure({ sponsor: null }), null);
  const d = sponsorDisclosure({ sponsor: { brand: "Acme", disclosure: "Paid partnership with Acme" } });
  assert.equal(d?.heading, "Sponsored by Acme");
  assert.match(d?.accessibilityLabel ?? "", /^Advertising disclosure\. Sponsored by Acme/);
});

test("durations", () => {
  assert.equal(formatDuration(596000), "9:56");
  assert.equal(formatDuration(3_725_000), "1:02:05");
  assert.equal(formatDuration(null), null);
  assert.equal(durationLabel(30000), "30 seconds");
  assert.equal(durationLabel(120000), "2 minutes");
});
