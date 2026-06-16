// Multi-language dubbing + captions producer, local (no creds). For each requested language: LLM-translated
// transcript (translations.mjs) + local macOS `say` TTS assembled into one full-length dub track aligned to
// the dialogue timings, plus a same-language caption doc. Robotic placeholder voices; ElevenLabs is the gated
// upgrade. Adding a language = add a translations entry + a voice. No em dashes.

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { TRANSLATIONS, VOICE_PREFS } from "./translations.mjs";

const whisperJson = process.argv[2];
const mediaDir = process.argv[3];
const publicBase = process.argv[4];
const langs = (process.argv[5] || "es").split(",").map((s) => s.trim()).filter(Boolean);

const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;
const durationS = Math.ceil(seg.at(-1).end) + 1;
const enDoc = (() => {
  try { return JSON.parse(readFileSync(join(mediaDir, "captions.json"), "utf8")); } catch { return { segments: [], meta: {} }; }
})();

// Available voices: name -> locale, parsed from `say -v '?'`.
const voiceList = execFileSync("say", ["-v", "?"]).toString().split("\n").map((line) => {
  const m = line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s/);
  return m ? { name: m[1].trim(), locale: m[2] } : null;
}).filter(Boolean);
function resolveVoice(lang) {
  for (const pref of VOICE_PREFS[lang] ?? []) {
    const hit = voiceList.find((v) => v.name === pref || v.name.startsWith(pref));
    if (hit) return hit.name;
  }
  const byLocale = voiceList.find((v) => v.locale.startsWith(lang + "_"));
  return byLocale?.name ?? null;
}

const dubUrls = {};
for (const lang of langs) {
  const tx = TRANSLATIONS[lang];
  const voice = resolveVoice(lang);
  if (!tx || !voice) {
    console.log(`  skip ${lang}: ${!tx ? "no translation" : "no voice"}`);
    continue;
  }

  // 1) TTS each line to a wav, then SEQUENCE placement so a line that is longer than its original timing
  // cannot overlap the next line (overlap is what made the dub muffled and unintelligible). Each line starts
  // at max(its original start, end of the previous line); slight drift is acceptable for a placeholder dub.
  const wavs = [];
  let prevEnd = 0;
  seg.forEach((s, i) => {
    const aiff = join(mediaDir, `${lang}_seg_${i}.aiff`);
    const wav = join(mediaDir, `${lang}_seg_${i}.wav`);
    execFileSync("say", ["-v", voice, "-r", "210", "-o", aiff, tx[i] ?? s.text]);
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", aiff, "-ar", "44100", "-ac", "2", wav], { stdio: "ignore" });
    rmSync(aiff, { force: true });
    const durStr = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim();
    const durS = parseFloat(durStr) || 1;
    const start = Math.max(s.start, prevEnd + 0.06);
    prevEnd = start + durS;
    wavs.push({ wav, startMs: Math.round(start * 1000) });
  });

  // 2) Assemble one dub track: silent base + each line delayed to its start, summed.
  const inputs = ["-f", "lavfi", "-t", String(durationS), "-i", "anullsrc=r=44100:cl=stereo"];
  wavs.forEach((w) => inputs.push("-i", w.wav));
  let fc = "";
  wavs.forEach((w, i) => { fc += `[${i + 1}]adelay=${w.startMs}|${w.startMs}[d${i}];`; });
  fc += `[0]` + wavs.map((_, i) => `[d${i}]`).join("") + `amix=inputs=${wavs.length + 1}:normalize=0:dropout_transition=0[out]`;
  execFileSync("ffmpeg", ["-hide_banner", "-y", ...inputs, "-filter_complex", fc, "-map", "[out]", "-c:a", "aac", "-b:a", "128k", join(mediaDir, `${lang}_dub.m4a`)], { stdio: "ignore" });
  wavs.forEach((w) => rmSync(w.wav, { force: true }));

  // 3) Same-language caption doc (translated text; signals reused from EN as an approximation).
  const segments = seg.map((s, i) => {
    const en = enDoc.segments[i] ?? {};
    const text = tx[i] ?? s.text;
    const toks = text.split(/\s+/).filter(Boolean);
    const span = s.end - s.start;
    const words = toks.map((t, j) => {
      const ew = en.words?.[Math.min(j, (en.words?.length ?? 1) - 1)] ?? {};
      return {
        text: t,
        startTime: +(s.start + (span * j) / toks.length).toFixed(3),
        endTime: +(s.start + (span * (j + 1)) / toks.length).toFixed(3),
        f0_hz: ew.f0_hz ?? 0, energy_rms: ew.energy_rms ?? 0.026, harmonic_ratio: ew.harmonic_ratio ?? 0.5,
        character_id: en.character_id,
      };
    });
    return { text, speaker: en.speaker, speakerColor: en.speakerColor, character_id: en.character_id, emotion: en.emotion, intent: en.intent, startTime: s.start, endTime: s.end, words };
  });
  writeFileSync(join(mediaDir, `${lang}_captions.json`), JSON.stringify({ version: 2, lang, meta: enDoc.meta, segments }, null, 2));

  dubUrls[lang] = `${publicBase}/${lang}_dub.m4a`;
  console.log(`  ${lang}: voice=${voice} -> ${lang}_dub.m4a (${durationS}s) + ${lang}_captions.json`);
}

console.log("DUB_URLS=" + JSON.stringify(dubUrls));
