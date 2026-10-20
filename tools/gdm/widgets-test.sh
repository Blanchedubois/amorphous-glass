#!/bin/bash
# widgets-test.sh OUTDIR lock|gdm [kinds...]: workshop only. Puts tahoe-widgets' weather and
# calendar widgets on Liquid Glass panes (tahoe-gdm glass.js) on the lock screen (main's
# tahoe-lockscreen, tools/lockscreen/run.sh) or the login screen (tools/gdm/run.sh), with the
# user's weather location set in the throwaway shell only. Kinds: weather-small weather-medium
# calendar-day calendar-month calendar-medium (default: weather-small calendar-day).
set -eu
out=$1; where=$2; shift 2
H=$(cd "$(dirname "$0")" && pwd); R=$(cd "$H/../.." && pwd)
M=${TAHOE_MAIN:-$HOME/Projects/liquid-glass}
# LOCK_MONITOR=WxH: run main's lock harness on another virtual monitor, from a patched copy in a
# temp dir (main's tools/lockscreen/run.sh is not changed)
lockrun() {
  local copy; copy=$(mktemp -d)
  cp -r "$M/tools/lockscreen/." "$copy/"
  sed -i "s/--virtual-monitor 2560x1440@120/--virtual-monitor ${LOCK_MONITOR:-2560x1440}@60/" "$copy/run.sh"
  grep -q -- "--virtual-monitor ${LOCK_MONITOR:-2560x1440}@60" "$copy/run.sh" || { echo "lock harness: monitor not patched" >&2; return 1; }
  "$copy/run.sh" "$@"
  rm -rf "$copy"
}     # the checkout with the installed lock screen
W=$M/extensions/tahoe-widgets@cachyos-tahoe
ext=$(mktemp -d)/widgets-test@local
cp -r "$H/widgets-test@local" "$ext"
cp "$W/weather.js" "$W/calendar.js" "$W/clocks.js" "$W/glass.js" "$W/stylesheet.css" "$ext/"
cp "$R/extensions/tahoe-gdm@cachyos-tahoe/glass.js" "$ext/paneglass.js"
export WIDGETS_TEST="${*:-weather-small calendar-day}"
export WIDGETS_TEST_LOCATION="$(dconf read /org/gnome/shell/weather/locations)"
case $where in
  lock) TAHOE_TEST_EXT_DIRS="$M/extensions/tahoe-lockscreen@cachyos-tahoe $ext" lockrun "$out" dark ;;
  gdm) GDM_TEST_EXT_DIRS="$R/extensions/tahoe-gdm@cachyos-tahoe $ext" "$H/run.sh" "$out" userfonts ;;
  *) echo "lock|gdm" >&2; exit 2 ;;
esac
rm -rf "$(dirname "$ext")"
