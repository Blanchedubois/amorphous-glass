#!/bin/bash
# run.sh BMS_ZIP OUTDIR [RUNS]: a throwaway headless gnome-shell (own XDG dirs, keyfile settings,
# own D-Bus session) with the user's Blur My Shell settings, the test driver and the given build.
set -eu
zip=$1; out=$2; runs=${3:-5}
H=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d -p "$H" root.XXXX)
mkdir -p "$out"; rm -f "$out"/*.png "$out"/log.jsonl
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export GSETTINGS_BACKEND=keyfile TAHOE_TEST_OUT=$out TAHOE_TEST_RUNS=$runs
ext=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$ext/blur-my-shell@aunetx" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
unzip -q "$zip" -d "$ext/blur-my-shell@aunetx"
glib-compile-schemas "$ext/blur-my-shell@aunetx/schemas"
cp -r "$H/tahoe-motion-test@local" "$ext/"
# TAHOE_TEST_EXTS="uuid ...": the user's other extensions too (copied, with their settings)
extra=""
for uuid in ${TAHOE_TEST_EXTS:-}; do
  cp -r "$HOME/.local/share/gnome-shell/extensions/$uuid" "$ext/"
  [ -d "$ext/$uuid/schemas" ] && glib-compile-schemas "$ext/$uuid/schemas" 2>/dev/null
  extra="$extra, '$uuid'"
done
# TAHOE_TEST_EXT_DIRS="/path/uuid ...": extensions from a checkout (no settings of their own)
for dir in ${TAHOE_TEST_EXT_DIRS:-}; do
  cp -r "$dir" "$ext/"
  extra="$extra, '$(basename "$dir")'"
done
export TAHOE_TEST_EXTRA="$extra"
# TAHOE_TEST_ICONS=1: the user's own icon theme (their icons dir, their icon-theme setting)
if [ -n "${TAHOE_TEST_ICONS:-}" ]; then
  ln -s "$HOME/.local/share/icons" "$XDG_DATA_HOME/icons"
  export TAHOE_TEST_ICON_THEME=$(env -u GSETTINGS_BACKEND XDG_CONFIG_HOME=$HOME/.config gsettings get org.gnome.desktop.interface icon-theme)
fi
kf=$XDG_CONFIG_HOME/glib-2.0/settings/keyfile
python3 - "$kf" <<'PY'
import os, subprocess, sys
out = []
def dump(path):
    # the user's own dconf database, not the throwaway XDG_CONFIG_HOME exported above
    env = dict(os.environ, XDG_CONFIG_HOME=os.path.expanduser('~/.config'))
    env.pop('GSETTINGS_BACKEND', None)
    txt = subprocess.run(['dconf', 'dump', path], capture_output=True, text=True, env=env).stdout
    if not txt.strip():
        sys.exit(f'dconf dump {path} is empty')
    base = path.strip('/')
    for line in txt.splitlines():
        if line.startswith('[') and line.endswith(']'):
            sub = line[1:-1].strip('/')
            out.append(f"[{base + ('/' + sub if sub else '')}]")
        else:
            out.append(line)
dump('/org/gnome/shell/extensions/')
dump('/org/gnome/desktop/background/')
out += ['[org/gnome/shell]',
        "enabled-extensions=['blur-my-shell@aunetx', 'user-theme@gnome-shell-extensions.gcampax.github.com', 'tahoe-motion-test@local'" + os.environ.get('TAHOE_TEST_EXTRA', '') + "]",
        'disable-extension-version-validation=true',
        'welcome-dialog-last-shown-version=\'999\'',
        '[org/gnome/shell/extensions/user-theme]', "name='MacTahoe-Dark'",
        '[org/gnome/desktop/interface]', "color-scheme='prefer-dark'", "font-name='SF Pro Text 10'", 'enable-animations=true']
if os.environ.get('TAHOE_TEST_ICON_THEME'):
    out.append('icon-theme=' + os.environ['TAHOE_TEST_ICON_THEME'])
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
PY
timeout 90 dbus-run-session -- gnome-shell --headless --wayland --no-x11 --wayland-display "tahoe-test-$$" \
  --virtual-monitor 2560x1440@120 --force-animations > "$out/shell.log" 2>&1 || true
cp "$kf" "$out/keyfile.after" 2>/dev/null; rm -rf "$root"
echo "done: $(grep -c . "$out/log.jsonl" 2>/dev/null || echo 0) records"
