// Extract a real per-word Pakistan Sign Language (PSL) dictionary from the open sign-language-datasets repo
// (sign-language-translator/sign-language-datasets). That repo ships a label->video-URL map (GitHub releases)
// and a label->English/Urdu/Hindi token mapping, so we can build an English-keyed PSL dictionary the same sign
// pipeline consumes. PSL clips come from one academy (Hamza Foundation), so the signer/framing is consistent.
// Licensing of source clips is handled separately by the operator. No em dashes.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const pkUrlsJson = process.argv[2];
const pkMapJson = process.argv[3];
const whisperJson = process.argv[4]; // path to transcript, or the literal "ALL" to extract the whole dictionary
const outDir = process.argv[5];
const tmp = "/tmp/psldl";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// label -> release video URL
const urls = JSON.parse(readFileSync(pkUrlsJson, "utf8"))["sign-dictionary"];
const labelUrl = new Map();
for (const d of urls) for (const [f, u] of Object.entries(d.file_to_url || {})) labelUrl.set(f.split("/").pop().replace(/\.mp4$/, ""), u);

// English token -> labels (first matching label wins)
const map = JSON.parse(readFileSync(pkMapJson, "utf8"));
const enLabel = new Map();
for (const k of Object.keys(map)) for (const m of map[k].mapping || []) {
  for (let w of (m.token?.en) || []) {
    w = w.toLowerCase().replace(/\(.*?\)/g, "").trim();
    if (w && /^[a-z]+$/.test(w) && labelUrl.has(m.label)) {
      if (!enLabel.has(w)) enLabel.set(w, []);
      enLabel.get(w).push(m.label);
    }
  }
}

const lemma = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
let targets;
if (whisperJson === "ALL") {
  // whole dictionary: every English word that has a sign video. Downloads are deduped by label below, so
  // synonyms that share one sign do not re-download.
  targets = [...enLabel.keys()];
} else {
  const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;
  targets = [...new Set(seg.flatMap((s) => (s.words ?? []).map((w) => lemma(w.word))))].filter((w) => w.length > 1 && enLabel.has(w));
}

const probe = (f) => {
  try {
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type:format=duration -of csv=p=0 "${f}" 2>/dev/null`, { timeout: 25000 }).toString();
    const dur = parseFloat(out.split(/\s+/).filter(Boolean).pop());
    return out.includes("video") && dur > 0.25 && dur < 30 ? dur : 0;
  } catch { return 0; }
};

const labelFile = new Map(); // label -> first encoded output path, so shared signs are copied not re-downloaded
const tryWord = (word) => {
  const out = join(outDir, `psl-${word}.webm`);
  if (existsSync(out) && probe(out)) return "skip";
  for (const label of enLabel.get(word)) {
    const cached = labelFile.get(label);
    if (cached && existsSync(cached)) { copyFileSync(cached, out); return "ok"; }
    const raw = join(tmp, `${word}.src`);
    try { execFileSync("curl", ["-sL", "--max-time", "40", "-A", UA, "-o", raw, labelUrl.get(label)], { stdio: "ignore", timeout: 50000 }); } catch { continue; }
    if (!probe(raw)) { rmSync(raw, { force: true }); continue; }
    try {
      execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-an",
        "-vf", "scale=480:640:force_original_aspect_ratio=increase,crop=480:640,fps=24,setsar=1",
        "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", out], { stdio: "ignore", timeout: 90000, killSignal: "SIGKILL" });
    } catch { rmSync(raw, { force: true }); rmSync(out, { force: true }); continue; }
    rmSync(raw, { force: true });
    if (probe(out)) { labelFile.set(label, out); return "ok"; }
    rmSync(out, { force: true });
  }
  return "fail";
};

let ok = 0, skip = 0, fail = 0;
for (const word of targets) {
  let r = "fail";
  try { r = tryWord(word); } catch { r = "fail"; }
  if (r === "ok") ok++; else if (r === "skip") skip++; else fail++;
  if ((ok + skip + fail) % 15 === 0) console.log(`  progress ${ok + skip + fail}/${targets.length} (ok ${ok}, kept ${skip}, fail ${fail})`);
}

const onDisk = readdirSync(outDir).filter((f) => /^psl-.+\.webm$/.test(f)).map((f) => f.replace(/^psl-|\.webm$/g, ""));
writeFileSync(join(outDir, "dictionary.json"), JSON.stringify({ source: "sign-language-translator/sign-language-datasets (Pakistan Sign Language, Hamza Foundation Academy)", note: "licensing handled separately by operator", count: onDisk.length, words: onDisk.sort() }, null, 2));
console.log(`DONE: ${onDisk.length} real PSL word clips on disk (this run: ok ${ok}, kept ${skip}, fail ${fail}) of ${targets.length} targets`);
console.log("words:", onDisk.sort().join(" "));
