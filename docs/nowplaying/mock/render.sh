#!/bin/bash
# render.sh: the Phase 0 mockups (docs/NOWPLAYING_PLAN.md) from scene.html with headless Chromium,
# then compose.py lays the storyboards out. Output in docs/nowplaying/mock/out (PNG, 16:9).
set -eu
H=$(cd "$(dirname "$0")" && pwd)
frames=$(mktemp -d)
trap 'rm -rf "$frames"' EXIT
shot() {   # name scale query
  chromium --headless=new --disable-gpu --hide-scrollbars --window-size=2560,1440 \
    --force-device-scale-factor="$2" --screenshot="$frames/$1.png" "file://$H/scene.html?$3" >/dev/null 2>&1
}
# the two layouts, clean and annotated (1920x1080)
shot lyrics 0.75 'lyrics=1'
shot lyrics-notes 0.75 'lyrics=1&notes=1'
shot nolyrics 0.75 'lyrics=0'
shot nolyrics-notes 0.75 'lyrics=0&notes=1'
# the cover tilt: the pointer near the top left, then the bottom right
shot tilt-a 0.75 'lyrics=1&tilt=0.18,0.22'
shot tilt-b 0.75 'lyrics=1&tilt=0.85,0.8'
# enter: sharp desktop, blur + drop, pour, cover in, settled
shot enter-0 0.375 'blur=0&swirl=0&card=none&content=0&ui=0'
shot enter-1 0.375 'blur=22&swirl=0.08&card=drop&content=0&ui=0'
shot enter-2 0.375 'blur=40&swirl=0.3&card=pour&content=0&ui=0'
shot enter-3 0.375 'blur=48&swirl=0.65&card=full&content=0.7&ui=0.3'
shot enter-4 0.375 'blur=48&swirl=1&card=full&content=1&ui=1'
# exit: content gathers, swirl fades to the blurred desktop, blur sharpens
shot exit-0 0.375 'blur=48&swirl=1&card=full&content=1&ui=1'
shot exit-1 0.375 'blur=48&swirl=0.8&card=pour&content=0&ui=0'
shot exit-2 0.375 'blur=44&swirl=0.25&card=none&content=0&ui=0'
shot exit-3 0.375 'blur=16&swirl=0&card=none&content=0&ui=0'
shot exit-4 0.375 'blur=0&swirl=0&card=none&content=0&ui=0'
# lyrics to no lyrics: the column slides to the centre, the lyrics fade out to the right
shot swap-0 0.375 'lyrics=1&layout=1'
shot swap-1 0.375 'lyrics=1&layout=0.55'
shot swap-2 0.375 'lyrics=0&layout=0.15'
shot swap-3 0.375 'lyrics=0&layout=0'
mkdir -p "$H/out"
python3 -I "$H/compose.py" "$frames" "$H/out"
