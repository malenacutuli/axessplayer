// Modern captions-with-intention pipeline, fully LOCAL (no external creds):
//   1. Whisper (open SOTA ASR) gives the word-level transcript + timings  [run separately]
//   2. signal processing on the PCM gives per-word LOUDNESS (-> 7-level intensity) and PITCH (-> width)
//   3. character attribution (an LLM reading the script; here a reviewed map) assigns speaker + CI color
// Emits the CaptionSegment[] document the player's CaptionsWithIntention renderer consumes (0009a).
// No em dashes.

import { readFileSync, writeFileSync } from "node:fs";

const whisperJson = process.argv[2];
const wavPath = process.argv[3];
const outPath = process.argv[4];

// ---- character attribution (the "identify characters" step) ----
// CI palette colors per character of this fruit-noir cold open.
const COLORS = { Strawberry: "#E51717", Banana: "#E5E517", Grape: "#8C6BED", Apple: "#17E517" };
// Segment index -> speaker, attributed from the dialogue/context.
const SPK = [
  "Banana", "Strawberry", "Strawberry", "Strawberry", "Banana", "Grape", "Strawberry", "Strawberry",
  "Strawberry", "Strawberry", "Banana", "Banana", "Strawberry", "Strawberry", "Strawberry", "Strawberry",
  "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Banana", "Banana",
  "Strawberry", "Strawberry", "Strawberry", "Banana", "Banana", "Strawberry", "Grape", "Grape",
  "Grape", "Banana", "Banana", "Strawberry", "Strawberry", "Apple", "Apple", "Apple", "Apple", "Apple",
  "Apple", "Strawberry",
];
// LLM emotion + intent pass: the script is ground truth for scripted content, so the LLM (here, reviewed)
// tags meaning per segment, fused downstream with DSP intensity. Drives the qualitative caption treatment.
const EMO = [
  "panicked", "cold", "menacing", "menacing", "panicked", "cold", "cold", "bitter",
  "vulnerable", "bitter", "menacing", "panicked", "grief", "cold", "cold", "cold",
  "bitter", "menacing", "bitter", "triumphant", "cold", "triumphant", "panicked", "panicked",
  "cold", "cold", "cold", "panicked", "panicked", "menacing", "panicked", "panicked",
  "panicked", "panicked", "fearful", "cold", "cold", "grave", "grave", "grave", "grave", "grave",
  "menacing", "cold",
];
const INT = [
  "plea", "challenge", "accusation", "accusation", "plea", "lie", "reveal", "dismissal",
  "confession", "reveal", "taunt", "plea", "confession", "reveal", "threat", "reveal",
  "reveal", "threat", "narration", "declaration", "reveal", "reveal", "plea", "plea",
  "dismissal", "dismissal", "threat", "protest", "plea", "threat", "alarm", "alarm",
  "demand", "confession", "warning", "demand", "reveal", "reveal", "reveal", "reveal", "reveal", "warning",
  "reveal", "reveal",
];

// ---- read 16k mono 16-bit PCM wav ----
const buf = readFileSync(wavPath);
// find 'data' chunk
let p = 12;
let dataOff = 44, dataLen = buf.length - 44, sampleRate = 16000;
while (p + 8 <= buf.length) {
  const id = buf.toString("ascii", p, p + 4);
  const sz = buf.readUInt32LE(p + 4);
  if (id === "fmt ") sampleRate = buf.readUInt32LE(p + 12);
  if (id === "data") { dataOff = p + 8; dataLen = sz; break; }
  p += 8 + sz;
}
const N = Math.floor(dataLen / 2);
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2);

function rmsDb(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return -90;
  let sum = 0;
  for (let i = s0; i < s1; i++) { const v = pcm[i] / 32768; sum += v * v; }
  const rms = Math.sqrt(sum / (s1 - s0));
  return rms > 0 ? 20 * Math.log10(rms) : -90;
}
// linear RMS (0..1) over a word window, for the volume->size axis.
function rmsLinear(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return 0;
  let sum = 0;
  for (let i = s0; i < s1; i++) { const v = pcm[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / (s1 - s0));
}
// Harmonic ratio: low-band over total energy via a 1-pole split at ~1.5 kHz (a spectral-tilt proxy). Fuller
// voices (more low-harmonic energy) -> toward 1 -> wider glyphs; sharper voices -> toward 0 -> narrower.
function harmonicRatio(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return 0.5;
  const fc = 1500, dt = 1 / sampleRate, rc = 1 / (2 * Math.PI * fc), a = dt / (rc + dt);
  let lp = 0, low = 0, high = 0, n = 0;
  for (let i = s0; i < s1; i++) { const x = pcm[i] / 32768; lp = lp + a * (x - lp); const hp = x - lp; low += lp * lp; high += hp * hp; n++; }
  const lr = Math.sqrt(low / n), hr = Math.sqrt(high / n);
  return lr + hr > 0 ? lr / (lr + hr) : 0.5;
}
// coarse autocorrelation F0 (Hz) over a word window, for high/low/normal pitch
function pitchHz(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  const len = s1 - s0;
  if (len < 400) return 0;
  const minLag = Math.floor(sampleRate / 350); // 350 Hz
  const maxLag = Math.floor(sampleRate / 80);  // 80 Hz
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag && lag < len; lag++) {
    let c = 0;
    for (let i = s0; i < s1 - lag; i += 2) c += (pcm[i] / 32768) * (pcm[i + lag] / 32768);
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag ? sampleRate / bestLag : 0;
}
// Median F0 over up to 4 sub-windows of the word, dropping octave outliers, for a smoother weight axis.
function medianF0(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  const len = s1 - s0;
  if (len < 800) return pitchHz(s0, s1);
  const k = Math.min(4, Math.floor(len / 600));
  const vals = [];
  for (let j = 0; j < k; j++) {
    const a = s0 + Math.floor((len * j) / k);
    const b = s0 + Math.floor((len * (j + 1)) / k);
    const f = pitchHz(a, b);
    if (f > 0) vals.push(f);
  }
  if (!vals.length) return pitchHz(s0, s1);
  vals.sort((a, b) => a - b);
  return Math.round(vals[Math.floor(vals.length / 2)]);
}

// ---- per-word prosody ----
const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;
const allWords = [];
for (const s of seg) for (const w of s.words ?? []) {
  const db = rmsDb(w.start * sampleRate, w.end * sampleRate);
  const f0 = pitchHz(w.start * sampleRate, w.end * sampleRate);
  allWords.push({ w, db, f0 });
}
const dbs = allWords.map((x) => x.db).filter((d) => d > -80).sort((a, b) => a - b);
const mean = dbs.reduce((a, b) => a + b, 0) / dbs.length;
const std = Math.sqrt(dbs.reduce((a, b) => a + (b - mean) ** 2, 0) / dbs.length) || 1;
const f0s = allWords.map((x) => x.f0).filter((f) => f > 0).sort((a, b) => a - b);
const f0med = f0s[Math.floor(f0s.length / 2)] || 150;

function intensity(db, text) {
  const allCaps = /[A-Z]{2,}/.test(text.replace(/[^A-Za-z]/g, ""));
  const z = (db - mean) / std;
  if (allCaps && z > 0.4) return "screaming";
  if (z < -1.3) return "whisper";
  if (z < -0.6) return "quiet";
  if (z < 0.55) return "normal";
  if (z < 1.15) return "loud";
  if (z < 1.75) return "yelling";
  return "screaming";
}
function pitchLabel(f0) {
  if (!f0) return "normal";
  if (f0 > f0med * 1.15) return "high";
  if (f0 < f0med * 0.85) return "low";
  return "normal";
}

// ---- build CaptionSegment[] with RAW per-word signals (CWI producer output) ----
// Each word carries the three independent signals the renderer maps to the Roboto Flex axes:
//   energy_rms  -> size   (volume to size, 3/5/12 ratio)
//   f0_hz       -> weight (pitch to weight, higher pitch = lighter)
//   harmonic_ratio -> width (harmonics to width, fuller = wider)
const segments = seg.map((s, i) => {
  const speaker = SPK[i] ?? "Strawberry";
  const words = (s.words ?? []).map((w) => {
    const s0 = w.start * sampleRate, s1 = w.end * sampleRate;
    const db = rmsDb(s0, s1);
    // Median-smoothed F0 over sub-windows to reduce octave jumps (a local stand-in for pyin; pyin via librosa
    // is the gated upgrade for cleaner pitch).
    const f0 = medianF0(s0, s1);
    return {
      text: w.word.trim(),
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
      startTime: +w.start.toFixed(3),
      endTime: +w.end.toFixed(3),
      character_id: speaker,
      f0_hz: Math.round(f0),
      energy_rms: +rmsLinear(s0, s1).toFixed(4),
      harmonic_ratio: +harmonicRatio(s0, s1).toFixed(3),
      // legacy labels kept for any non-axis use; the renderer derives everything from the raw signals above.
      intensity: intensity(db, w.word.trim()),
    };
  });
  return {
    text: s.text.trim(),
    speaker,
    speakerColor: COLORS[speaker] ?? "#22E3D0",
    character_id: speaker,
    emotion: EMO[i],
    intent: INT[i],
    startTime: +s.start.toFixed(3),
    endTime: +s.end.toFixed(3),
    words,
  };
});

// Clip-level calibration so the renderer maps energy/f0 across the actual range of this clip.
const energies = segments.flatMap((s) => s.words.map((w) => w.energy_rms)).filter((e) => e > 0).sort((a, b) => a - b);
const f0all = segments.flatMap((s) => s.words.map((w) => w.f0_hz)).filter((f) => f > 0).sort((a, b) => a - b);
const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
const meta = {
  font: "Roboto Flex",
  energy: { p10: pct(energies, 0.1), p50: pct(energies, 0.5), p90: pct(energies, 0.9), max: energies.at(-1) ?? 0 },
  f0: { p10: pct(f0all, 0.1), p50: pct(f0all, 0.5), p90: pct(f0all, 0.9) },
};

writeFileSync(outPath, JSON.stringify({ version: 2, meta, segments }, null, 2));
console.log(`wrote ${segments.length} segments, ${segments.reduce((n, s) => n + s.words.length, 0)} words to ${outPath}`);
console.log("characters:", [...new Set(SPK)].join(", "));
console.log("meta:", JSON.stringify(meta));
