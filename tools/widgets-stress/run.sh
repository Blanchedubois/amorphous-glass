#!/bin/bash
# run.sh OUTDIR LAYOUT_JSON [EXT_DIR]: a throwaway headless gnome-shell (own XDG dirs, keyfile
# settings, own D-Bus session; never touches the running desktop) with the installed Blur My Shell,
# its settings, and the widgets from EXT_DIR (default: this checkout's).
#   DRIVER=widget-shot@local    screenshots per mode (SHOT_RECT, SHOT_MODES, SHOT_FAKE_PLAYER=1)
#   DRIVER=widget-stress@local  the stress test, results in OUTDIR/stress.jsonl
#                               (STRESS_ONLY=drags|idle|control for one part)
set -eu
out=$(realpath -m "$1"); layout=$(realpath "$2"); extsrc=${3:-$(cd "$(dirname "$0")/../.." && pwd)/extensions/tahoe-widgets@cachyos-tahoe}
H=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d -t tahoe-widgets-test.XXXX)
# its own runtime dir (short: the socket path has a length limit), so the test shell never creates
# or deletes the real session's crash guard file in /run/user
export XDG_RUNTIME_DIR=$(mktemp -d "/tmp/wsrun.XXXX")
chmod 700 "$XDG_RUNTIME_DIR"
mkdir -p "$out"; rm -f "$out"/*.png
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export GSETTINGS_BACKEND=keyfile SHOT_OUT=$out DRIVER=${DRIVER:-widget-shot@local} STRESS_HARNESS=$H
ext=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$ext" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CONFIG_HOME/tahoe-glass" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
cp -r "$HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx" "$ext/"
glib-compile-schemas "$ext/blur-my-shell@aunetx/schemas"
cp -r "$H/${DRIVER:-widget-shot@local}" "$extsrc" "$ext/"
cp "$layout" "$XDG_CONFIG_HOME/tahoe-glass/widgets.json"
echo "widgets=on" > "$XDG_CONFIG_HOME/tahoe-glass/state"; echo "mode=dark" >> "$XDG_CONFIG_HOME/tahoe-glass/state"
# fonts the user has (SF Pro) are in ~/.local/share/fonts: keep them visible
mkdir -p "$XDG_DATA_HOME"; ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"
# and the user's icon themes, with the user's icon theme set below (as on the desktop)
[ -d "$HOME/.local/share/icons" ] && ln -s "$HOME/.local/share/icons" "$XDG_DATA_HOME/icons"
export ICON_THEME=$(env -u GSETTINGS_BACKEND XDG_CONFIG_HOME="$HOME/.config" gsettings get org.gnome.desktop.interface icon-theme 2>/dev/null || echo "'Adwaita'")
kf=$XDG_CONFIG_HOME/glib-2.0/settings/keyfile
python3 -I - "$kf" <<'PY'
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
for p in ('/org/gnome/shell/extensions/blur-my-shell/', '/org/gnome/desktop/background/', '/org/gnome/shell/weather/', '/org/gnome/Weather/', '/org/gnome/clocks/'):
    dump(p)
out += ['[org/gnome/shell]',
        "enabled-extensions=['blur-my-shell@aunetx', 'tahoe-widgets@cachyos-tahoe', '" + os.environ.get('DRIVER', 'widget-shot@local') + "']",
        'disable-extension-version-validation=true', "welcome-dialog-last-shown-version='999'",
        '[org/gnome/desktop/interface]', "color-scheme='prefer-dark'", "font-name='SF Pro Text 10'", "clock-format='12h'",
        'icon-theme=' + os.environ.get('ICON_THEME', "'Adwaita'")]
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
PY
# TEST_KEYRING=1: a throwaway keyring for this test session, unlocked with a test password, in
# the test's own data folder and D-Bus session (never PAM, never the real keyring). It is started
# before the shell so nothing in the session starts an empty one first.
pre=()
[ "${TEST_KEYRING:-0}" = 1 ] && pre=(sh -c 'printf test-only-pw | gnome-keyring-daemon --unlock --components=secrets >/dev/null; gnome-keyring-daemon --start --components=secrets >/dev/null; exec "$@"' sh)
timeout ${SHOT_TIMEOUT:-60} dbus-run-session -- "${pre[@]}" gnome-shell --headless --wayland --no-x11 --wayland-display "wshot-$$" \
  --virtual-monitor 2560x1440@60 > "$out/shell.log" 2>&1 || true
# the test session's document portal mounts a FUSE file system in its runtime dir
fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || fusermount -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$root" "$XDG_RUNTIME_DIR"
ls "$out"
