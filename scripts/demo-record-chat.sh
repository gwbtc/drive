#!/usr/bin/env bash
# Drive both booted demo ships through the CHAT tour (client/demo/demo-chat.mjs),
# then stitch ~nec | ~bus side by side into demo/groundwire-chat-demo.mp4.
# Prereq: scripts/demo-boot.sh has left both ships up (writes .piers/demo.env).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "$HERE/.piers/demo.env"

cd "$HERE/client"
rm -rf demo/out
echo "=== recording — driving ~nec and ~bus through the chat tour ==="
node demo/demo-chat.mjs || bun demo/demo-chat.mjs

NEC="$(ls demo/out/nec/*.webm | head -1)"
BUS="$(ls demo/out/bus/*.webm | head -1)"
mkdir -p "$HERE/demo"
OUT="$HERE/demo/groundwire-chat-demo.mp4"
echo "=== stitching side-by-side → mp4 ==="
ffmpeg -y -i "$NEC" -i "$BUS" -filter_complex \
  "[0:v]pad=iw+3:ih:0:0:color=0xd98a58[l];[l][1:v]hstack=inputs=2,scale=1920:-2,format=yuv420p[v]" \
  -map "[v]" -r 24 -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT" 2>/dev/null
echo "=== done ==="
ls -lh "$OUT"
