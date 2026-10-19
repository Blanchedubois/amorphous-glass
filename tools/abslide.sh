#!/bin/bash
# abslide.sh: while the user slides across the top bar menus, cycle the popup glass through four
# setups (40 s each, a notification at each change), log when each ran, then put everything back.
# Read the result with: python3 tools/analyze.py plus the times in ~/.cache/tahoe-abslide.log
BS=$HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/schemas
K=org.gnome.shell.extensions.blur-my-shell.popup
LOG=$HOME/.cache/tahoe-abslide.log
g(){ gsettings --schemadir "$BS" "$@"; }
orig_freeze=$(g get $K motion-freeze); orig_pipe=$(g get $K pipeline); orig_blur=$(g get $K blur)
restore(){ g set $K blur "$orig_blur"; g set $K pipeline "$orig_pipe"; g set $K motion-freeze "$orig_freeze"
           echo "$(date -u +%FT%T) restored" >> "$LOG"; notify-send -t 4000 "Glass test done" "Settings are back as they were."; }
trap restore EXIT INT TERM
step(){ echo "$(date -u +%FT%T) $1" >> "$LOG"; notify-send -t 3000 "Glass test $1" "Slide across the top bar menus for 40 s"; sleep 40; }
echo "$(date -u +%FT%T) start" >> "$LOG"
sleep 5
step "A: as now (frozen while moving)"
g set $K motion-freeze false; step "B: live while moving"
g set $K motion-freeze true; g set $K pipeline 'pipeline_glassbar_plain'; step "C: plain blur, no refraction"
g set $K pipeline "$orig_pipe"; g set $K blur false; step "D: no menu glass"
