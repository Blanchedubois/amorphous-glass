#!/bin/bash
# screensaver-video.sh OUTDIR: Tahoe Now Playing filmed for the showcase at 60 fps, in a throwaway
# headless gnome-shell (as tools/nowplaying/run.sh: its own XDG dirs, runtime dir, keyfile settings
# and D-Bus session; the lock disabled; the system bus seen only through tools/gdm/sysbus.sh, so no
# real GDM or PAM), with the user's Blur My Shell and its settings, the MacTahoe shell theme, a
# private PipeWire for GNOME's screencast, and the driver tools/showcase/npvideo@local.
#   NPV_TITLE, NPV_ARTIST, NPV_ALBUM, NPV_COVER, NPV_TITLE2: the song shown (the lyrics on screen are
#   always our own placeholder lines)
# Output: OUTDIR/screensaver.mp4 and OUTDIR/marks.jsonl (open, entered, cover, off-cover, next,
# escape, stop: seconds from the recording's start).
set -eu
out=$(realpath -m "$1")
H=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$H/../.." && pwd)
mkdir -p "$out"; rm -f "$out"/marks.jsonl "$out"/screensaver*.mp4
root=$(mktemp -d -t npvideo.XXXX)
export XDG_RUNTIME_DIR=$(mktemp -d "/tmp/npv.XXXX")
chmod 700 "$XDG_RUNTIME_DIR"
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export GSETTINGS_BACKEND=keyfile NPV_OUT=$out
ext=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$ext" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
cp -r "$H/npvideo@local" "$R/extensions/tahoe-nowplaying@cachyos-tahoe" "$ext/"
glib-compile-schemas "$ext/tahoe-nowplaying@cachyos-tahoe/schemas"
cp -r "$HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx" "$ext/"
glib-compile-schemas "$ext/blur-my-shell@aunetx/schemas"
ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"
ln -s "$HOME/.local/share/icons" "$XDG_DATA_HOME/icons"     # the user's cursor theme
pic=$(env -u GSETTINGS_BACKEND XDG_CONFIG_HOME="$HOME/.config" gsettings get org.gnome.desktop.background picture-uri)
pic_dark=$(env -u GSETTINGS_BACKEND XDG_CONFIG_HOME="$HOME/.config" gsettings get org.gnome.desktop.background picture-uri-dark)
cursor=$(env -u GSETTINGS_BACKEND XDG_CONFIG_HOME="$HOME/.config" gsettings get org.gnome.desktop.interface cursor-theme)
kf=$XDG_CONFIG_HOME/glib-2.0/settings/keyfile
env -u GSETTINGS_BACKEND XDG_CONFIG_HOME="$HOME/.config" dconf dump /org/gnome/shell/extensions/blur-my-shell/ \
  | sed -E 's#^\[/?\]$#[org/gnome/shell/extensions/blur-my-shell]#; t; s#^\[([^]/][^]]*)\]$#[org/gnome/shell/extensions/blur-my-shell/\1]#' > "$kf"
cat >> "$kf" <<KF
[org/gnome/shell]
enabled-extensions=['blur-my-shell@aunetx', 'user-theme@gnome-shell-extensions.gcampax.github.com', 'tahoe-nowplaying@cachyos-tahoe', 'npvideo@local']
disable-extension-version-validation=true
welcome-dialog-last-shown-version='999'
[org/gnome/shell/extensions/user-theme]
name='MacTahoe-Dark'
[org/gnome/desktop/interface]
color-scheme='prefer-dark'
font-name='SF Pro Text 10'
cursor-theme=$cursor
cursor-size=24
enable-animations=true
[org/gnome/desktop/background]
picture-uri=$pic
picture-uri-dark=$pic_dark
[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false
[org/gnome/desktop/session]
idle-delay=uint32 0
KF
mkdir -p "$XDG_CONFIG_HOME/tahoe-glass"; echo "mode=dark" > "$XDG_CONFIG_HOME/tahoe-glass/state"
mkdir -p "$XDG_CONFIG_HOME/wireplumber/wireplumber.conf.d"
cat > "$XDG_CONFIG_HOME/wireplumber/wireplumber.conf.d/90-no-devices.conf" <<'WP'
wireplumber.profiles = {
  main = {
    monitor.alsa = disabled
    monitor.alsa-midi = disabled
    monitor.bluez = disabled
    monitor.bluez-midi = disabled
    monitor.libcamera = disabled
    monitor.v4l2 = disabled
  }
}
WP
. "$R/tools/gdm/sysbus.sh"
sysbus_start
timeout ${NPV_TIMEOUT:-120} dbus-run-session -- sh -c 'pipewire & wireplumber & sleep 1; exec "$@"' sh \
  gnome-shell --headless --wayland --no-x11 --wayland-display "npv-$$" --virtual-monitor 2560x1440@60 \
  > "$out/shell.log" 2>&1 || true
sysbus_stop
fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || fusermount -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$root" "$XDG_RUNTIME_DIR"
cat "$out/marks.jsonl" 2>/dev/null || true
[ -f "$out/screensaver-take.mp4" ] || { echo "screensaver-video: no recording (see $out/shell.log)" >&2; exit 1; }
mv "$out/screensaver-take.mp4" "$out/screensaver.mp4"
ls -l "$out/screensaver.mp4"
