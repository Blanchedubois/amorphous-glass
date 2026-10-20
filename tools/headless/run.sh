#!/bin/bash
# run.sh BMS_ZIP OUTDIR [RUNS]: a throwaway headless gnome-shell (own XDG dirs, keyfile settings,
# own D-Bus session) with the user's Blur My Shell settings, the test driver and the given build.
set -eu
zip=$1; out=$2; runs=${3:-5}
H=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d -p "$H" root.XXXX)
mkdir -p "$out"; rm -f "$out"/*.png "$out"/log.jsonl
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export GSETTINGS_BACKEND=keyfile TAHOE_TEST_OUT=$out TAHOE_TEST_RUNS=$runs TAHOE_TEST_TOOLS=$H
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
# TAHOE_TEST_USERLOOK=1: GTK apps look as on the desktop: the user's icons (linked, read only),
# their GTK 3 and 4 CSS with the glass layers (copied) and their interface settings
if [ "${TAHOE_TEST_USERLOOK:-}" = 1 ]; then
  [ -d "$HOME/.local/share/icons" ] && ln -s "$HOME/.local/share/icons" "$XDG_DATA_HOME/icons"
  for d in gtk-3.0 gtk-4.0; do [ -d "$HOME/.config/$d" ] && cp -r "$HOME/.config/$d" "$XDG_CONFIG_HOME/"; done
fi
# TAHOE_TEST_OVERRIDES=FILE: the shell overrides template FILE (config/gnome-shell-overrides.css),
# rendered for dark mode into a copy of the MacTahoe Dark shell theme that the test shell uses;
# the user's own theme folder is not touched. TAHOE_TEST_MODE=light: MacTahoe Light, light colours.
if [ -n "${TAHOE_TEST_OVERRIDES:-}" ]; then
  tmode=${TAHOE_TEST_MODE:-dark}; tname=$([ "$tmode" = light ] && echo Light || echo Dark)
  theme="$XDG_DATA_HOME/themes/MacTahoe-Dark-test"
  mkdir -p "$XDG_DATA_HOME/themes"; cp -r "$HOME/.themes/MacTahoe-$tname" "$theme"
  repo=$(cd "$(dirname "$TAHOE_TEST_OVERRIDES")/.." && pwd)
  python3 "$repo/scripts/glass-tokens.py" render "$TAHOE_TEST_OVERRIDES" "$tmode" | python3 -c '
import re, sys
p = sys.argv[1]; ov = sys.stdin.read().strip(); css = open(p).read()
css = re.sub(r"\n*/\* tahoe-overrides:.*?/\* end tahoe-overrides \*/\n?", "\n", css, flags=re.S)
open(p, "w").write(css.rstrip() + "\n\n" + ov + "\n")' "$theme/gnome-shell/gnome-shell.css"
  export TAHOE_TEST_KEYS="${TAHOE_TEST_KEYS:-} org/gnome/shell/extensions/user-theme:name='MacTahoe-Dark-test'"
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
if os.environ.get('TAHOE_TEST_USERLOOK') == '1':
    dump('/org/gnome/desktop/interface/')
out += ['[org/gnome/shell]',
        "enabled-extensions=['blur-my-shell@aunetx', 'user-theme@gnome-shell-extensions.gcampax.github.com', 'tahoe-motion-test@local'" + os.environ.get('TAHOE_TEST_EXTRA', '') + "]",
        'disable-extension-version-validation=true',
        "favorite-apps=['org.gnome.Nautilus.desktop', 'org.gnome.Console.desktop', 'org.gnome.Settings.desktop']",
        'welcome-dialog-last-shown-version=\'999\'',
        '[org/gnome/shell/extensions/user-theme]', "name='MacTahoe-Dark'",
        '[org/gnome/desktop/interface]', "color-scheme='prefer-dark'", "font-name='SF Pro Text 10'", 'enable-animations=true']
# TAHOE_TEST_KEYS="path:key=value ...": settings changed for this run (after the user's)
for item in os.environ.get('TAHOE_TEST_KEYS', '').split():
    path, kv = item.split(':', 1)
    out += [f'[{path}]', kv]
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
PY
timeout ${TAHOE_TEST_TIMEOUT:-90} dbus-run-session -- gnome-shell --headless --wayland --no-x11 --wayland-display "tahoe-test-$$" \
  --virtual-monitor 2560x1440@120 --force-animations > "$out/shell.log" 2>&1 || true
cp "$kf" "$out/keyfile.after" 2>/dev/null; rm -rf "$root"
echo "done: $(grep -c . "$out/log.jsonl" 2>/dev/null || echo 0) records"
