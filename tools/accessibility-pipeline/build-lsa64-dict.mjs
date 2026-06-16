// Build an LSA (Argentine Sign Language) dictionary from the open LSA64 dataset (facundoq, Google Drive).
// LSA64 has 64 signs x 10 signers x 5 repetitions, files named signId_signerId_repetition.mp4, with official
// English glosses. Pick one clean repetition per sign, normalize to the uniform vertical format. A real third
// sign language for the platform. Licensing handled separately. No em dashes.

import { readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const srcDir = process.argv[2]; // dir of LSA64 mp4 files (.../all)
const outDir = process.argv[3];

// Official LSA64 sign id -> English gloss (single token for the dictionary lookup).
const GLOSS = ["opaque","red","green","yellow","bright","lightblue","colors","pink","women","enemy","son","man",
  "away","drawer","born","learn","call","skimmer","bitter","sweetmilk","milk","water","food","argentina",
  "uruguay","country","lastname","where","mock","birthday","breakfast","photo","hungry","map","coin","music",
  "ship","none","name","patience","perfume","deaf","trap","rice","barbecue","candy","gum","spaghetti","yogurt",
  "accept","thanks","shutdown","appear","land","catch","help","dance","bathe","buy","copy","run","realize",
  "give","find"];

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const files = readdirSync(srcDir).filter((f) => /^\d{3}_\d{3}_\d{3}\.mp4$/.test(f));
const probe = (f) => { try { return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}" 2>/dev/null`).toString().trim()) || 0; } catch { return 0; } };

let ok = 0;
for (let id = 1; id <= 64; id++) {
  const word = GLOSS[id - 1];
  const out = join(outDir, `lsa-${word}.webm`);
  if (existsSync(out) && probe(out)) { ok++; continue; }
  const id3 = String(id).padStart(3, "0");
  // a steady middle signer/rep, fall back to the first available for this sign
  const pick = files.find((f) => f.startsWith(`${id3}_005_001`)) || files.find((f) => f.startsWith(`${id3}_`));
  if (!pick) { console.log("  no clip for", id, word); continue; }
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", join(srcDir, pick), "-an",
      "-vf", "scale=480:640:force_original_aspect_ratio=increase,crop=480:640,fps=24,setsar=1",
      "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", out],
      { stdio: "ignore", timeout: 90000, killSignal: "SIGKILL" });
    if (probe(out)) ok++;
  } catch { /* skip */ }
}
writeFileSync(join(outDir, "dictionary.json"), JSON.stringify({ source: "LSA64 (Argentine Sign Language, facundoq), 64 signs", note: "licensing handled separately by operator", count: ok, words: GLOSS }, null, 2));
console.log(`DONE: ${ok}/64 LSA signs -> ${outDir}`);
