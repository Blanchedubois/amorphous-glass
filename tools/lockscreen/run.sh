#!/bin/bash
# run.sh OUTDIR [light|dark]: a throwaway headless gnome-shell (own XDG dirs, keyfile settings, own
# D-Bus session) with the user's installed Blur My Shell and its settings, the user's wallpaper and
# lock screen picture, and the lock-test driver, which locks this shell (never the real session),
# opens the password prompt and takes screenshots.
# TAHOE_TEST_EXT_DIRS="/path/uuid ...": extensions from a checkout, enabled too (e.g. tahoe-lockscreen).
# TAHOE_LOCK_PICTURE=uri: another lock picture; TAHOE_LOCK_MATERIAL=json: glass material overrides.
# TAHOE_LOCK_MONITOR=WxH@Hz: the virtual monitor (default 2560x1440@120).
# The shell sees the system bus only through tools/gdm/sysbus.sh: its unlock prompt can never
# reach the real GDM, so a run never starts a real PAM check for the user (on 2026-10-20 runs
# without it counted as failed logins and pam_faillock locked the user's account).
set -eu
out=$1; mode=${2:-dark}
H=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d -p "${TMPDIR:-/tmp}" lockroot.XXXX)
mkdir -p "$out"
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
# its own runtime dir, so the test shell never creates or deletes the real session's
# gnome-shell-disable-extensions crash guard in /run/user/$UID
# (short path: the Wayland socket path must fit in 108 bytes)
export XDG_RUNTIME_DIR=$(mktemp -d "/tmp/lockrun.XXXX")
chmod 700 "$XDG_RUNTIME_DIR"
export GSETTINGS_BACKEND=keyfile TAHOE_TEST_OUT=$out TAHOE_LOCK_TAG=${TAHOE_LOCK_TAG:-$mode}
rm -f "$out/log-$TAHOE_LOCK_TAG.jsonl"
ext=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$ext" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
# the user's own fonts (SF Pro, Space Grotesk): fontconfig looks for them under $XDG_DATA_HOME
[ -d "$HOME/.local/share/fonts" ] && ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"
cp -r "$HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx" "$ext/"
glib-compile-schemas "$ext/blur-my-shell@aunetx/schemas"
cp -r "$H/lock-test@local" "$ext/"
extra=""
for dir in ${TAHOE_TEST_EXT_DIRS:-}; do
  cp -r "$dir" "$ext/"
  extra="$extra, '$(basename "$dir")'"
done
kf=$XDG_CONFIG_HOME/glib-2.0/settings/keyfile
TAHOE_TEST_EXTRA="$extra" MODE=$mode TAHOE_LOCK_PICTURE="${TAHOE_LOCK_PICTURE:-}" python3 -I - "$kf" <<'PY'
import os, subprocess, sys
out = []
def dump(path):
    env = dict(os.environ, XDG_CONFIG_HOME=os.path.expanduser('~/.config'))
    env.pop('GSETTINGS_BACKEND', None)
    txt = subprocess.run(['dconf', 'dump', path], capture_output=True, text=True, env=env).stdout
    base = path.strip('/')
    for line in txt.splitlines():
        if line.startswith('[') and line.endswith(']'):
            sub = line[1:-1].strip('/')
            out.append(f"[{base + ('/' + sub if sub else '')}]")
        else:
            out.append(line)
dump('/org/gnome/shell/extensions/blur-my-shell/')
dump('/org/gnome/desktop/background/')
dump('/org/gnome/desktop/screensaver/')
# the weather widget's location (the lock screen's widget column)
dump('/org/gnome/shell/weather/')
dark = os.environ['MODE'] == 'dark'
# TAHOE_LOCK_PICTURE=uri: a different lock picture (and wallpaper) for this run
pic = os.environ.get('TAHOE_LOCK_PICTURE')
if pic:
    out += ['[org/gnome/desktop/screensaver]', f"picture-uri='{pic}'",
            '[org/gnome/desktop/background]', f"picture-uri='{pic}'", f"picture-uri-dark='{pic}'"]
out += ['[org/gnome/shell]',
        "enabled-extensions=['blur-my-shell@aunetx', 'user-theme@gnome-shell-extensions.gcampax.github.com', 'lock-test@local'" + os.environ['TAHOE_TEST_EXTRA'] + "]",
        'disable-extension-version-validation=true',
        "welcome-dialog-last-shown-version='999'",
        '[org/gnome/shell/extensions/user-theme]', f"name='MacTahoe-{'Dark' if dark else 'Light'}'",
        '[org/gnome/desktop/interface]', f"color-scheme='{'prefer-dark' if dark else 'default'}'",
        "font-name='SF Pro Text 10'", 'enable-animations=true',
        '[org/gnome/desktop/lockdown]', 'disable-lock-screen=false']
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
PY
. "$H/../gdm/sysbus.sh"
sysbus_start
timeout ${TAHOE_TEST_TIMEOUT:-60} dbus-run-session -- gnome-shell --headless --wayland --no-x11 --wayland-display "tahoe-lock-$$" \
  --virtual-monitor ${TAHOE_LOCK_MONITOR:-2560x1440@120} > "$out/shell-$TAHOE_LOCK_TAG.log" 2>&1 || true
sysbus_stop
# the test session's document portal mounts a FUSE file system in its runtime dir
fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || fusermount -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$root" "$XDG_RUNTIME_DIR"
echo "done: $(grep -c . "$out/log-$TAHOE_LOCK_TAG.jsonl" 2>/dev/null || echo 0) records"
