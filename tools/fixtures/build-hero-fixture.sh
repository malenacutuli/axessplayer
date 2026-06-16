#!/usr/bin/env bash
# Build the prompt-01 hero-series content fixture media: 6 beats, each with a fast and a slow PACE
# variant cut from existing footage (no generation). Same content per beat, different pace, so the
# Gate A experiment varies exactly one controllable axis. Output is served by the local media-server
# at /media/hero/<file>. No em dashes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/tools/media-server/uploads/mqfkdb5y-9lzxgp/master.m3u8"
OUT="$ROOT/tools/media-server/uploads/hero"
mkdir -p "$OUT"
BASE="$OUT/_base.mp4"

# Reassemble a single mp4 from the HLS base clip (real footage).
[ -f "$BASE" ] || ffmpeg -y -i "$SRC" -c copy "$BASE" 2>/dev/null

# 6 high-leverage beats: hook, two cliffhangers, branch point, pre-paywall, ending. Each a ~5s window.
OFFSETS=(0 5 10 15 20 25)
NAMES=(hook cliff1 cliff2 branch prepay ending)
i=0
for off in "${OFFSETS[@]}"; do
  n="${NAMES[$i]}"
  # slow = the designated showrunner cut (normal pace); fast = the tighter alternate (setpts 0.7).
  ffmpeg -y -ss "$off" -t 5 -i "$BASE" -an -vf "setpts=1.0*PTS" -c:v libx264 -crf 26 -preset veryfast -movflags +faststart "$OUT/${n}-slow.mp4" 2>/dev/null
  ffmpeg -y -ss "$off" -t 5 -i "$BASE" -an -vf "setpts=0.7*PTS" -c:v libx264 -crf 26 -preset veryfast -movflags +faststart "$OUT/${n}-fast.mp4" 2>/dev/null
  echo "beat $n: slow=$(du -h "$OUT/${n}-slow.mp4" | cut -f1) fast=$(du -h "$OUT/${n}-fast.mp4" | cut -f1)"
  i=$((i+1))
done
rm -f "$BASE"
echo "done. variants under $OUT, served at http://127.0.0.1:8095/media/hero/<name>-<pace>.mp4"
