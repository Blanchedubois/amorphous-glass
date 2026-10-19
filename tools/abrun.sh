#!/bin/bash
# abrun.sh: cycle Blur My Shell's popup glass through 4 setups (45 s each) while the probe logs,
# then put everything back exactly as it was.
BS=$HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/schemas
K=org.gnome.shell.extensions.blur-my-shell.popup
g(){ gsettings --schemadir "$BS" "$@"; }
orig_freeze=$(g get $K quick-settings-freeze); orig_pipe=$(g get $K pipeline); orig_blur=$(g get $K blur)
restore(){ g set $K blur "$orig_blur"; g set $K pipeline "$orig_pipe"; g set $K quick-settings-freeze "$orig_freeze"; echo "restored: blur=$orig_blur pipeline=$orig_pipe freeze=$orig_freeze"; }
trap restore EXIT INT TERM
step(){ echo "$(date +%T) setup $1"; }
step "A glass, freeze off";   g set $K quick-settings-freeze false; sleep 45
step "B glass, freeze on";    g set $K quick-settings-freeze true;  sleep 45
step "C plain blur only";     g set $K quick-settings-freeze false; g set $K pipeline 'pipeline_glassbar_plain'; sleep 45
step "D no menu blur";        g set $K pipeline "$orig_pipe"; g set $K blur false; sleep 45
