#!/usr/bin/env bash
# loop.sh TITLE.mp4 MONTAGE.mp4 OUT.mp4 [README.webp]
# The full video, one seamless loop: the title (it opens and closes on the home screen, whole), a
# 0.5 s dissolve into the montage (the same home screen, through the locked 1.6x camera: no zoom
# move, REWRITE.md "Joins"), the montage, and a 0.5 s dissolve from its last frame back into the
# title's first frame, so the end leads straight into the start. Both parts 1920x1080, 60 fps.
# The README loop is re-encoded from it with the title's Pillow encoder (render.py webp).
set -euo pipefail
title=$1 montage=$2 out=$3 webp=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
D=0.5
tlen=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$title")
mlen=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$montage")
o1=$(python3 -c "print($tlen - $D)")
o2=$(python3 -c "print($tlen + $mlen - 2 * $D)")
# [2]: the title's first frame, held for the closing dissolve: the video ends on the frame it
# starts on, so the loop has no seam
ffmpeg -loglevel error -y -i "$title" -i "$montage" -i "$title" -filter_complex "
  [0:v]fps=60,format=yuv420p,settb=AVTB[a];
  [1:v]fps=60,format=yuv420p,settb=AVTB[b];
  [2:v]fps=60,format=yuv420p,trim=end_frame=1,loop=loop=$((60 * 1)):size=1,setpts=N/60/TB,settb=AVTB[c];
  [a][b]xfade=transition=fade:duration=$D:offset=$o1[ab];
  [ab][c]xfade=transition=fade:duration=$D:offset=$o2[v]" \
  -map '[v]' -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$out"
# user, 2026-10-21: "the starting clip should be the title card": the loop is seamless, so the file is
# rotated to begin on the word, already on screen (ROTATE s into the title), and the home screen
# it opened on plays at the end instead
ROTATE=${ROTATE:-1.25}
if [ "$ROTATE" != 0 ]; then
  tmp="${out%.mp4}.unrotated.mp4"
  mv "$out" "$tmp"
  ffmpeg -loglevel error -y -i "$tmp" -filter_complex "
    [0:v]split[x][y];
    [x]trim=start=$ROTATE,setpts=PTS-STARTPTS[a];
    [y]trim=end=$ROTATE,setpts=PTS-STARTPTS[b];
    [a][b]concat=n=2:v=1[v]" -map '[v]' -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$out"
  rm -f "$tmp"
fi
ls -l "$out"
if [ -n "$webp" ]; then
  python3 "$here/../title/render.py" webp "$out" -o "$webp" --webp-width 1280 --webp-fps 24 --webp-quality 78 --webp-kmax 12
fi
