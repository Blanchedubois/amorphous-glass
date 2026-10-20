#!/bin/bash
# demo.sh OUT.mp4 [dark|light] [WxH]: a short video of the lock screen in a throwaway headless shell
# (run.sh, so behind the system-bus filter; no real GDM or PAM): music mode playing, paused,
# playing again. Frames from the driver (TAHOE_LOCK_GATE=demo, TAHOE_DEMO_FPS, default 8), encoded
# with ffmpeg at the rate they really came at (a full-screen PNG screenshot is slow: 1280x720 gives
# a smooth enough video, 2560x1440 about 1.5 frames a second), at half size above 1280 wide,
# blended up to 30 fps (the swirl and the fades are slow, so blending reads as smooth motion).
set -eu
out=$1; mode=${2:-dark}; mon=${3:-1280x720}
H=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
TAHOE_TEST_TIMEOUT=90 TAHOE_LOCK_MONITOR=$mon@60 TAHOE_LOCK_PLAYER=1 TAHOE_LOCK_GATE=demo TAHOE_LOCK_TAG=d \
  TAHOE_TEST_EXT_DIRS="${TAHOE_TEST_EXT_DIRS:-$H/../../extensions/tahoe-lockscreen@cachyos-tahoe}" "$H/run.sh" "$tmp" "$mode"
fps=$(python3 -c "import json,sys; print(next((json.loads(l)['fps'] for l in open(sys.argv[1]) if '\"demo\"' in l), 8))" "$tmp/log-d.jsonl")
ffmpeg -loglevel error -y -framerate "$fps" -i "$tmp/d-demo-%04d.png" -vf "scale='if(gt(iw,1280),iw/2,iw)':-2,minterpolate=fps=30:mi_mode=blend,format=yuv420p" -c:v libx264 -crf 20 "$out"
echo "video: $out ($(ls "$tmp"/d-demo-*.png | wc -l) frames at $fps fps)"
rm -rf "$tmp"
