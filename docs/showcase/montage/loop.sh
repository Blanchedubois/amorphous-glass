#!/usr/bin/env bash
# loop.sh TITLE.mp4 MONTAGE.mp4 OUT.mp4 [README.webp]
# The full video: the title (it starts and ends on the home screen) then the montage (which starts
# and ends on the same home screen), so the last frame leads straight back into the first. Both
# parts are 1920x1080 60 fps. The README loop is re-encoded from it with the title's Pillow encoder.
set -euo pipefail
title=$1 montage=$2 out=$3 webp=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
ffmpeg -loglevel error -y -i "$title" -i "$montage" \
  -filter_complex '[0:v]fps=60,format=yuv420p[a];[1:v]fps=60,format=yuv420p[b];[a][b]concat=n=2:v=1[v]' \
  -map '[v]' -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart "$out"
ls -l "$out"
if [ -n "$webp" ]; then
  python3 "$here/../title/render.py" webp "$out" -o "$webp"
fi
