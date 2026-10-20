#!/bin/bash
# run.sh OUTDIR [system|userfonts] [GRESOURCE]: a throwaway headless gnome-shell in session mode
# gdm (the login screen's mode; own XDG and runtime dirs, keyfile settings, its own D-Bus session)
# with GRESOURCE (default build/gdm/gnome-shell-theme.gresource) as its theme, through
# GNOME_SHELL_DATADIR (a folder of links to /usr/share/gnome-shell with the theme swapped). The
# gdm-shot driver screenshots the user list, the password prompt and a typed password.
#   system     only system fonts, as the real greeter (user gdm) sees them
#   userfonts  also ~/.local/share/fonts: how it looks once Space Grotesk/SF Pro are system-wide
# Settings as GDM will have them (scripts/gdm-theme.sh commands): clock-show-date=false, no logo;
# GDM_CLOCK_FORMAT=12h|24h overrides the clock format (default: the user's).
# GDM_MONITOR=WxH: the virtual monitor (default 2560x1440).
# Nothing here needs root or touches the real login: the shell sees the system bus through a
# filter without GDM (sysbus.sh), so its login screen can never start a real PAM check.
set -eu
out=$1; fonts=${2:-system}
H=$(cd "$(dirname "$0")" && pwd)
gres=${3:-$H/../../build/gdm/gnome-shell-theme.gresource}
root=$(mktemp -d -p "${TMPDIR:-/tmp}" gdmroot.XXXX)
mkdir -p "$out"
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export XDG_RUNTIME_DIR=$(mktemp -d "/tmp/gdmrun.XXXX")
chmod 700 "$XDG_RUNTIME_DIR"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
cp -r "$H/gdm-shot@local" "$XDG_DATA_HOME/gnome-shell/extensions/"
# GDM_TEST_EXT_DIRS="/path/uuid ...": gdm-mode extensions from a checkout, enabled before the driver
extra=""
for dir in ${GDM_TEST_EXT_DIRS:-}; do
  cp -r "$dir" "$XDG_DATA_HOME/gnome-shell/extensions/"
  extra="$extra'$(basename "$dir")', "
done
# fontconfig reads ~/.local/share/fonts through XDG_DATA_HOME: absent unless asked for
[ "$fonts" = userfonts ] && [ -d "$HOME/.local/share/fonts" ] && ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"
D=$root/datadir; mkdir -p "$D"
for f in /usr/share/gnome-shell/*; do ln -s "$f" "$D/"; done
rm "$D/gnome-shell-theme.gresource"; ln -s "$(realpath "$gres")" "$D/gnome-shell-theme.gresource"
cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<KF
[org/gnome/shell]
enabled-extensions=[${extra}'gdm-shot@local']
disable-extension-version-validation=true
[org/gnome/desktop/interface]
clock-show-date=false
clock-show-weekday=false
clock-format='${GDM_CLOCK_FORMAT:-$(gsettings get org.gnome.desktop.interface clock-format | tr -d "'")}'
[org/gnome/login-screen]
logo=''
KF
export GSETTINGS_BACKEND=keyfile GDM_SHOT_OUT=$out GDM_SHOT_TAG=${GDM_SHOT_TAG:-$fonts} GNOME_SHELL_DATADIR=$D
rm -f "$out/$GDM_SHOT_TAG-log.jsonl"
# ~/.fonts and ~/.local/share/fonts are also in fontconfig's default list under HOME: hide HOME
# for the system run so the greeter's font fallback is what user gdm gets
[ "$fonts" = system ] && export HOME=$root/home && mkdir -p "$HOME"
. "$H/sysbus.sh"
sysbus_start
timeout ${GDM_TEST_TIMEOUT:-60} dbus-run-session -- gnome-shell --headless --wayland --no-x11 --mode=gdm \
  --wayland-display "tahoe-gdm-$$" --virtual-monitor ${GDM_MONITOR:-2560x1440}@60 > "$out/shell-$GDM_SHOT_TAG.log" 2>&1 || true
sysbus_stop
fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$root" "$XDG_RUNTIME_DIR"
grep -h "GDM SHOT ERR" -A5 "$out/shell-$GDM_SHOT_TAG.log" || true
echo "done: $(ls "$out"/$GDM_SHOT_TAG-*.png 2>/dev/null | wc -l) shots"
