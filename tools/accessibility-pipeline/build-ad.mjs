// Audio description producer, local (no creds). Gaps come from the Whisper segment boundaries; the LLM (here,
// reviewed) authors concise present-tense scene text per gap; local macOS `say` renders the AD audio (a robotic
// placeholder; ElevenLabs is the gated upgrade). Outputs AudioDescriptionSegment[] and the per-segment audio
// files. EAD: if the AD line is longer than the gap, requiresExtension=true so the player pauses the video.
// No em dashes.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const whisperJson = process.argv[2];
const mediaDir = process.argv[3]; // tools/media-server/uploads/<id>
const publicBase = process.argv[4]; // http://127.0.0.1:8095/media/<id>

const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;

// LLM-authored AD lines, keyed to the dialogue GAP they fill (gap start in seconds). Present tense, describes
// what a sighted viewer sees: setting, action, expression. Authored from the script (scripted = script truth).
const AD = [
  { at: 11.9, text: "Strawberry turns and walks out, leaving Banana alone on the rumpled bed." },
  { at: 22.9, text: "Banana grins, oblivious, as Grape slides her arm through his." },
  { at: 42.3, text: "Strawberry straightens her blazer, her face hardening into resolve." },
  { at: 78.6, text: "She slides the signed dismissal across the polished desk." },
  { at: 84.2, text: "Grape claws through her purse, the useless cards trembling in her hands." },
  { at: 101.0, text: "Apple the detective spreads a fan of documents across the table." },
];

// Find the gap length available at each AD start: time until the next dialogue segment begins.
function gapAfter(t) {
  const next = seg.find((s) => s.start > t + 0.05);
  return next ? next.start - t : 6;
}

const segments = AD.map((ad, i) => {
  const aiff = join(mediaDir, `ad_${i}.aiff`);
  const m4a = join(mediaDir, `ad_${i}.m4a`);
  execFileSync("say", ["-v", "Samantha", "-r", "190", "-o", aiff, ad.text]);
  execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", aiff, "-c:a", "aac", "-b:a", "96k", m4a], { stdio: "ignore" });
  const durStr = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", m4a]).toString().trim();
  const durS = parseFloat(durStr) || 3;
  const gap = gapAfter(ad.at);
  const requiresExtension = durS > gap - 0.2;
  return {
    id: `ad_${i}`,
    text: ad.text,
    startTime: ad.at,
    endTime: +(ad.at + durS).toFixed(2),
    audioUrl: `${publicBase}/ad_${i}.m4a`,
    audioDurationMs: Math.round(durS * 1000),
    requiresExtension,
    extensionType: "pause",
    gapMs: Math.round(gap * 1000),
  };
});

writeFileSync(join(mediaDir, "ad.json"), JSON.stringify({ version: 1, voice: "placeholder:say", segments }, null, 2));
console.log(`wrote ${segments.length} AD segments`);
for (const s of segments) console.log(`  @${s.startTime}s dur=${(s.audioDurationMs / 1000).toFixed(1)}s gap=${(s.gapMs / 1000).toFixed(1)}s ext=${s.requiresExtension} | ${s.text}`);
