#!/bin/bash
# lockmusic-test.sh OUTDIR [dark|light]: workshop only. The lock screen (main's tahoe-lockscreen,
# tools/lockscreen/run.sh) with a fake player playing and lockmusic-test@local: the album-colour
# swirl as the whole background, the cover in the centre, the widgets stacked on the left.
# TAHOE_LOCK_ART=path picks another cover.
set -eu
out=$1; mode=${2:-dark}
H=$(cd "$(dirname "$0")" && pwd); R=$(cd "$H/../.." && pwd)
M=${TAHOE_MAIN:-$HOME/Projects/liquid-glass}
# LOCK_MONITOR=WxH: run main's lock harness on another virtual monitor, from a patched copy in a
# temp dir (main's tools/lockscreen/run.sh is not changed)
lockrun() {
  local copy; copy=$(mktemp -d)
  cp -r "$M/tools/lockscreen/." "$copy/"
  sed -i "s/--virtual-monitor 2560x1440@120/--virtual-monitor ${LOCK_MONITOR:-2560x1440}@60/" "$copy/run.sh"
  grep -q -- "--virtual-monitor ${LOCK_MONITOR:-2560x1440}@60" "$copy/run.sh" || { echo "lock harness: monitor not patched" >&2; return 1; }
  # never the real GDM: its unlock prompt would start real PAM checks (sysbus.sh)
  . "$H/sysbus.sh"
  sysbus_start || return 1
  "$copy/run.sh" "$@"
  sysbus_stop
  rm -rf "$copy"
}
W=$M/extensions/tahoe-widgets@cachyos-tahoe
ext=$(mktemp -d)/lockmusic-test@local
cp -r "$H/lockmusic-test@local" "$ext"
cp "$W/weather.js" "$W/calendar.js" "$W/clocks.js" "$W/glass.js" "$W/palette.js" "$W/stylesheet.css" "$ext/"
cp "$R/extensions/tahoe-gdm@cachyos-tahoe/glass.js" "$ext/paneglass.js"
# the weather widget's location, in the throwaway shell only (widgets-test@local does the same)
export WIDGETS_TEST_LOCATION="$(dconf read /org/gnome/shell/weather/locations)"
TAHOE_LOCK_PLAYER=1 TAHOE_TEST_EXT_DIRS="$M/extensions/tahoe-lockscreen@cachyos-tahoe $ext" lockrun "$out" "$mode"
rm -rf "$(dirname "$ext")"
