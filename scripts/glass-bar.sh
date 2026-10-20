#!/usr/bin/env bash
# Floating Liquid Glass top bar for an existing GNOME desktop (MacTahoe), like the Tahoe skin's:
#   - Blur My Shell upgraded to v76 (unreleased; built from a pinned commit) for rounded glass
#   - Open Bar for the floating pill shape ONLY: its menu, notification, font and GTK styling stay off
#   - top bar: rounded static blur of the wallpaper with Blur My Shell's "Liquid Glass" effect
# Everything stays in your home folder; no sudo.
# tahoe-repair enforces this look while Blur My Shell v76 is installed ('undo' puts v75 back,
# which switches tahoe-repair back to the plain bar).
#
#   bash glass-bar.sh apply      install and configure, then LOG OUT AND BACK IN
#   bash glass-bar.sh glass off  keep the floating bar, plain blur instead of Liquid Glass (instant)
#   bash glass-bar.sh glass on   Liquid Glass back on (instant)
#   bash glass-bar.sh menus on   live blur behind quick settings, dropdowns, calendar, notifications,
#                                OSDs and dialogs such as Power Off, as in the Tahoe VM (instant)
#   bash glass-bar.sh menus off  menus back to how they were before 'apply' (instant)
#   bash glass-bar.sh dock on    the dock in live Liquid Glass, as the bar and menus (instant)
#   bash glass-bar.sh dock off   the dock back to how it was before 'apply' (instant)
#   bash glass-bar.sh apps on    live Liquid Glass behind Files and the other whitelisted apps (instant)
#   bash glass-bar.sh apps off   app windows back to how they were before 'apply' (instant)
#   bash glass-bar.sh mode light Tahoe light (light apps), 'mode dark' Tahoe dark, 'mode milky' the
#                                pre-mode look: milky glass over dark apps (docs/liquid-glass.md)
#   bash glass-bar.sh overrides  the shell CSS overrides, rendered with tokens/, into both shell themes
#   bash glass-bar.sh radii      Blur My Shell's corner radius keys from tokens/radius.json
#   bash glass-bar.sh rebuild    rebuild and reinstall the patched Blur My Shell, then log out and back in
#   bash glass-bar.sh status     whether the patched Blur My Shell is the one installed
#   bash glass-bar.sh undo       put everything back exactly as before 'apply', then log out and back in
set -euo pipefail

BMS_COMMIT=470ae2d558e53e04171e19da4907f8e6031f346f   # blur-my-shell main, 2026-10-18, version 76
OPENBAR_UUID=openbar@neuromorph
BMS_UUID=blur-my-shell@aunetx
BACKUP_ROOT="$HOME/.local/share/glass-backup"
BACKUP="$BACKUP_ROOT/original"
# your choices, which tahoe-repair enforces at every login: enabled=1, bar=glass|plain, menus=on|off, dock=on|off, apps=on|off, mode=light|dark|milky
STATE="$HOME/.config/tahoe-glass/state"
SRC="$HOME/.local/src"
EXT="$HOME/.local/share/gnome-shell/extensions"
EXT_PATH=/org/gnome/shell/extensions/
# patch on top of BMS_COMMIT: quick settings pieces blurred one by one (no card), brighter glass edges
BMS_PATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/bms-tahoe-glass.patch"
# Liquid Glass tokens (docs/STANDARD.md): radii and per-mode colours, and the shell CSS they fill in
TOKENS_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/glass-tokens.py"
OVERRIDES_CSS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/gnome-shell-overrides.css"
OPENBAR_PRESET_URL=https://raw.githubusercontent.com/kayozxo/GNOME-macOS-Tahoe/6eb17c244fdefb02e81e77128ac5f1be1bb162ee/.config/extensions/openBar/Tahoe-Dark

if [ "$(id -u)" -eq 0 ]; then echo "Run this as yourself, not root."; exit 1; fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then echo "Run this from a terminal inside your GNOME session."; exit 1; fi
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# GLib aborts GNOME Shell when one dconf change notification carries 256+ keys
# (gsettings.c "assertion failed: (l < 256)"), so settings are written in batches of at most 100.
dconf_apply() { # base_path dump_file [current_dump_file]: write the dump's keys in small batches;
                # with a current dump, only keys that differ are written and keys missing from the dump are reset
  python3 - "$@" <<'PY'
import subprocess, sys
base, new_file = sys.argv[1], sys.argv[2]
cur_file = sys.argv[3] if len(sys.argv) > 3 else None
def parse(f):
    out, sec = {}, None
    for line in open(f):
        line = line.rstrip('\n')
        if line.startswith('[') and line.endswith(']'):
            sec = line[1:-1]
        elif sec is not None and '=' in line:
            k, v = line.split('=', 1)
            out[(sec, k)] = v
    return out
new = parse(new_file)
cur = parse(cur_file) if cur_file else {}
writes = [(s, k, v) for (s, k), v in new.items() if cur.get((s, k)) != v]
resets = [(s, k) for (s, k) in cur if (s, k) not in new] if cur_file else []
for s, k in resets:
    subprocess.run(['dconf', 'reset', base + ('' if s == '/' else s + '/') + k], check=True)
for i in range(0, len(writes), 100):
    chunk, last = [], None
    for s, k, v in writes[i:i + 100]:
        if s != last:
            chunk.append(f'[{s}]'); last = s
        chunk.append(f'{k}={v}')
    subprocess.run(['dconf', 'load', base], input='\n'.join(chunk) + '\n', text=True, check=True)
print(f'  {len(writes)} settings written, {len(resets)} reset')
PY
}

set_state() { # key value
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  if grep -q "^$1=" "$STATE"; then sed -i "s|^$1=.*|$1=$2|" "$STATE"; else echo "$1=$2" >> "$STATE"; fi
}

ensure_backup() {
  if [ -e "$BACKUP/extensions.dconf" ]; then echo "  backup already present: $(readlink -f "$BACKUP")"; return; fi
  local d
  d="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)-before-glass"
  mkdir -p "$d"
  dconf dump /org/gnome/ > "$d/org-gnome.dconf"
  dconf dump "$EXT_PATH" > "$d/extensions.dconf"
  gsettings get org.gnome.shell enabled-extensions > "$d/enabled-extensions.txt"
  gsettings get org.gnome.shell disabled-extensions > "$d/disabled-extensions.txt"
  for e in $(gnome-extensions list); do printf '%s %s\n' "$e" "$(gnome-extensions info "$e" | sed -n 's/ *Version: //p')"; done > "$d/extension-versions.txt"
  [ -d "$EXT/$BMS_UUID" ] && cp -a "$EXT/$BMS_UUID" "$d/$BMS_UUID-v75"
  ln -sfn "$d" "$BACKUP"
  echo "  backup saved: $d"
}

# enabled-extensions list editing
ext_list_add() { python3 -c 'import ast,sys;l=ast.literal_eval(sys.argv[1] or "[]");print(l if sys.argv[2] in l else l+[sys.argv[2]])' "$(gsettings get org.gnome.shell enabled-extensions | sed 's/^@as //')" "$1"; }

# Modes (docs/liquid-glass.md): 'light' and 'dark' follow macOS Tahoe, apps included;
# 'milky' is the shell glass tuned before modes, over dark apps. Older state files used
# tint=light|dark: tint=dark reads as dark, anything else as milky.
glass_mode() {
  local m; m=$(sed -n 's/^mode=//p' "$STATE" 2>/dev/null | tail -1)
  if [ -z "$m" ]; then [ "$(sed -n 's/^tint=//p' "$STATE" 2>/dev/null | tail -1)" = dark ] && m=dark || m=milky; fi
  echo "$m"
}

# One Liquid Glass recipe for every glass surface (bar, menus, dock, apps); only the blur
# radius differs per surface, and the tint per mode.
glass_params() { # BLUR_RADIUS [search]
  local tint tint_color shadow=0.2 rim=0.55 ao=0.3
  case "$(glass_mode)" in
    light) tint=0.18; tint_color='[1.0, 1.0, 1.0, 1.0]' ;;        # Tahoe light: clear, milky glass
    dark)  tint=0.42; tint_color='[0.133, 0.133, 0.149, 1.0]' ;;  # Tahoe dark: smoky grey glass
    *)     tint=0.12; tint_color='[1.0, 1.0, 1.0, 1.0]' ;;        # milky: the look tuned before modes
  esac
  # 'search': the overview's search result panels, raised glass with more prominent shading
  # (user, 2026-10-20; docs/gnome-tahoe/search-glass-plan.md): a denser tint, a stronger drop
  # shadow, inner edge shadow and rim light
  if [ "${2:-}" = search ]; then
    case "$(glass_mode)" in light) tint=0.30 ;; dark) tint=0.55 ;; *) tint=0.22 ;; esac
    shadow=0.32; rim=0.70; ao=0.42
  fi
  echo "{
  'strength': <0.8>, 'blur_radius': <$1>, 'edge_size': <12.0>, 'falloff': <2.4>,
  'refraction_style': <0.0>, 'rim_width': <3.0>, 'rgb_fringing': <0.06>,
  'gloss': <0.8>, 'fresnel_angle': <45.0>, 'fresnel_width': <1.0>, 'specular_strength': <0.0>,
  'tint': <$tint>, 'tint_color': <$tint_color>, 'backdrop_zoom': <1.0>, 'shadow': <$shadow>,
  'rim_light': <$rim>, 'rim_light_width': <0.45>, 'ao': <$ao>, 'ao_width': <0.2>
}"
}

bar_blur() { # glass | plain : top bar = rounded static blur, with or without Liquid Glass
  python3 - "$EXT/$BMS_UUID/schemas" "$1" "$(glass_params 12.0)" <<'PY'
import sys
from gi.repository import Gio, GLib
schemas, mode, params_text = sys.argv[1:4]
src = Gio.SettingsSchemaSource.new_from_directory(schemas, Gio.SettingsSchemaSource.get_default(), False)
def settings(sub=''):
    return Gio.Settings.new_full(src.lookup('org.gnome.shell.extensions.blur-my-shell' + sub, False), None, None)
root, panel = settings(), settings('.panel')
pipelines = {}
old = root.get_value('pipelines')
for i in range(old.n_children()):
    e = old.get_child_value(i)
    f = e.get_child_value(1)
    pipelines[e.get_child_value(0).get_string()] = {
        f.get_child_value(j).get_child_value(0).get_string(): f.get_child_value(j).get_child_value(1).get_variant()
        for j in range(f.n_children())}
def effect(text):
    return GLib.Variant.parse(GLib.VariantType('a{sv}'), text, None, None)
# kept separate from your existing pipelines, so nothing else changes
pipelines['pipeline_glassbar_glass'] = {'name': GLib.Variant('s', 'Glass bar (Liquid Glass)'), 'effects': GLib.Variant('av', [
    effect("{'type': <'refraction'>, 'id': <'effect_glassbar_glass'>, 'params': <%s>}" % params_text)])}
pipelines['pipeline_glassbar_plain'] = {'name': GLib.Variant('s', 'Glass bar (plain blur)'), 'effects': GLib.Variant('av', [
    effect("{'type': <'dual_kawase_blur'>, 'id': <'effect_glassbar_plain'>, 'params': <{'unscaled_radius': <12.0>, 'brightness': <1.0>}>}")])}
root.set_value('pipelines', GLib.Variant('a{sa{sv}}', pipelines))
panel.set_boolean('blur', True)
panel.set_boolean('static-blur', True)
panel.set_string('pipeline', 'pipeline_glassbar_glass' if mode == 'glass' else 'pipeline_glassbar_plain')
panel.set_int('corner-radius', 50)       # clamped to half the bar height: a pill
panel.set_int('rounded-corners', 0)
panel.set_boolean('override-background', True)
panel.set_int('style-panel', 0)          # transparent, so only the blur/glass shows
Gio.Settings.sync()
print(f"  top bar: {mode}, pipeline={panel.get_string('pipeline')}")
PY
}

# glass_pipeline ID NAME BLUR: a Blur My Shell pipeline with the top bar's Liquid Glass recipe
# (tint, rim, gloss) and its own blur radius, so every glass surface shares one look
glass_pipeline() { # ID NAME BLUR [profile]
  local id=$1 name=$2 blur=$3
  python3 - "$EXT/$BMS_UUID/schemas" "$id" "$name" "$(glass_params "$blur" "${4:-}")" <<'PY'
import sys
from gi.repository import Gio, GLib
schemas, pid, name, params = sys.argv[1:5]
src = Gio.SettingsSchemaSource.new_from_directory(schemas, Gio.SettingsSchemaSource.get_default(), False)
root = Gio.Settings.new_full(src.lookup('org.gnome.shell.extensions.blur-my-shell', False), None, None)
pipelines = {}
old = root.get_value('pipelines')
for i in range(old.n_children()):
    e = old.get_child_value(i); f = e.get_child_value(1)
    pipelines[e.get_child_value(0).get_string()] = {
        f.get_child_value(j).get_child_value(0).get_string(): f.get_child_value(j).get_child_value(1).get_variant()
        for j in range(f.n_children())}
effect = GLib.Variant.parse(GLib.VariantType('a{sv}'),
    "{'type': <'refraction'>, 'id': <'effect_%s'>, 'params': <%s>}" % (pid.replace('pipeline_', ''), params), None, None)
pipelines[pid] = {'name': GLib.Variant('s', name), 'effects': GLib.Variant('av', [effect])}
root.set_value('pipelines', GLib.Variant('a{sa{sv}}', pipelines))
Gio.Settings.sync()
PY
}

# restore_bms_section SECTION: one Blur My Shell section back to the pre-apply backup
restore_bms_section() {
  local section=$1 b cur
  b=$(readlink -f "$BACKUP")
  cur=$(mktemp)
  dconf dump "${EXT_PATH}blur-my-shell/" > "$cur"
  python3 - "$cur" "$b/extensions.dconf" "$section" > "$cur.new" <<'PY'
import sys
def sections(f):
    out, sec = {}, None
    for line in open(f):
        line = line.rstrip('\n')
        if line.startswith('['):
            sec = line
            out.setdefault(sec, [])
        elif sec and '=' in line:
            out[sec].append(line)
    return out
cur = sections(sys.argv[1]); old = sections(sys.argv[2]); sec = sys.argv[3]
cur[f'[{sec}]'] = old.get(f'[blur-my-shell/{sec}]', [])
for s, lines in cur.items():
    print(s); print('\n'.join(lines)); print()
PY
  dconf_apply "${EXT_PATH}blur-my-shell/" "$cur.new" "$cur"
  rm -f "$cur" "$cur.new"
}

dock() { # on | off : the dock in live Liquid Glass, its own theme background cleared
  local BS="$EXT/$BMS_UUID/schemas" S=org.gnome.shell.extensions.blur-my-shell.dash-to-dock
  if [ "$1" = on ]; then
    glass_pipeline pipeline_glassbar_dock 'Glass dock' 18.0
    gsettings --schemadir "$BS" set $S blur true
    gsettings --schemadir "$BS" set $S static-blur false
    gsettings --schemadir "$BS" set $S pipeline pipeline_glassbar_dock
    gsettings --schemadir "$BS" set $S override-background true
    gsettings --schemadir "$BS" set $S style-dash-to-dock 0
    gsettings --schemadir "$BS" set $S unblur-in-overview true
  else
    restore_bms_section dash-to-dock
  fi
  echo "  dock: $1"
}

# GTK4 apps in the Tahoe layer model (docs/liquid-glass.md): window chrome (header and
# sidebar areas) is glass over the window's live blur, content (lists, file views, text) nearly
# opaque, cards and buttons a translucent lift with the rim. The theme paints its surfaces from
# libadwaita's colours in about 60 rules; those rules are copied, scoped to every window except
# Files (which keeps the theme's own look), with the mode's values substituted, plus libadwaita's
# colour variables on the same windows. The block is marked so it can be replaced or removed.
GTK4_DIR="$HOME/.config/gtk-4.0"
GTK_BEGIN='/* tahoe-glass-gtk4: managed by glass-bar.sh */'
GTK_END='/* end tahoe-glass-gtk4 */'
gtk_strip() { # FILE: remove the marked block
  [ -f "$1" ] || return 0
  python3 - "$1" "$GTK_BEGIN" "$GTK_END" <<'PY'
import sys
p, b, e = sys.argv[1:4]
s = open(p).read()
while b in s and e in s:
    s = s[:s.index(b)].rstrip('\n') + '\n' + s[s.index(e) + len(e):].lstrip('\n')
open(p, 'w').write(s)
PY
}
gtk_glass() { # light | dark | off
  local f
  for f in "$GTK4_DIR/gtk-Dark.css" "$GTK4_DIR/gtk-Light.css"; do gtk_strip "$f"; done
  [ "$1" = off ] && return 0
  f="$GTK4_DIR/gtk-$([ "$1" = light ] && echo Light || echo Dark).css"
  [ -f "$f" ] || return 0
  python3 - "$f" "$1" "$GTK_BEGIN" "$GTK_END" "$TOKENS_PY" <<'PY'
import re, subprocess, sys
path, mode, begin, end, tokens = sys.argv[1:6]
def tok(name):  # Liquid Glass tokens (docs/STANDARD.md)
    return subprocess.run([sys.executable, tokens, 'get', name, mode], capture_output=True, text=True, check=True).stdout.strip()
menu_r, menu_gap, menu_row = tok('app_menu.radius'), tok('app_menu.gap'), tok('app_menu.row')
row_hover, row_pressed, separator = tok('hover'), tok('pressed'), tok('separator')
css = open(path).read()
T = {  # docs/liquid-glass.md, "Tokens used here"
  'light': dict(window='rgba(250, 250, 252, 0.62)', view='rgba(255, 255, 255, 0.95)',
                sidebar='rgba(255, 255, 255, 0.30)', card='rgba(255, 255, 255, 0.55)',
                dialog='rgba(250, 250, 252, 0.96)', popover='rgba(250, 250, 252, 0.97)',
                fill='rgba(255, 255, 255, 0.45)', hover='rgba(255, 255, 255, 0.65)', press='rgba(255, 255, 255, 0.8)',
                rim='rgba(255, 255, 255, 0.6)', outline='rgba(255, 255, 255, 0.35)'),
  'dark':  dict(window='rgba(36, 36, 40, 0.62)', view='rgba(30, 30, 33, 0.90)',
                sidebar='rgba(0, 0, 0, 0.12)', card='rgba(255, 255, 255, 0.06)',
                dialog='rgba(40, 40, 44, 0.94)', popover='rgba(44, 44, 48, 0.97)',
                fill='rgba(255, 255, 255, 0.10)', hover='rgba(255, 255, 255, 0.16)', press='rgba(255, 255, 255, 0.22)',
                rim='rgba(255, 255, 255, 0.14)', outline='rgba(255, 255, 255, 0.12)'),
}[mode]
COLORS = {
  'window_bg_color': T['window'], 'view_bg_color': T['view'],
  'headerbar_bg_color': 'transparent', 'headerbar_backdrop_color': 'transparent',
  'sidebar_bg_color': T['sidebar'], 'sidebar_backdrop_color': T['sidebar'],
  'secondary_sidebar_bg_color': T['sidebar'], 'secondary_sidebar_backdrop_color': T['sidebar'],
  'card_bg_color': T['card'], 'dialog_bg_color': T['dialog'], 'popover_bg_color': T['popover'],
  'thumbnail_bg_color': T['view'],
}
NOT_FILES = ':not(.nautilus-window)'
def scope(sel):
    sel = sel.strip()
    if not sel or sel.startswith((':root', '*')):
        return None
    m = re.match(r'window\b([.#:\[][^\s>+~]*)?', sel)
    if m:  # the selector is the window itself: exclude Files on that compound
        return sel[:m.end()] + NOT_FILES + sel[m.end():]
    return f'window{NOT_FILES} {sel}'
out = []
for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
    decls = []
    for d in body.split(';'):
        if ':' not in d:
            continue
        prop, val = d.split(':', 1)
        if not prop.strip().startswith('background'):
            continue
        new = val
        for n, c in COLORS.items():
            new = re.sub(r'@' + n + r'\b', c, new)
        if new != val:
            decls.append(f'{prop.strip()}: {new.strip()}')
    if not decls:
        continue
    sels = [x for x in (scope(x) for x in sel.split(',')) if x]
    if sels:
        out.append(',\n'.join(sels) + ' { ' + '; '.join(decls) + '; }')
var_names = {'window': '--window-bg-color', 'view': '--view-bg-color', 'sidebar': '--sidebar-bg-color',
             'card': '--card-bg-color', 'dialog': '--dialog-bg-color', 'popover': '--popover-bg-color'}
vars_ = ' '.join(f'{v}: {T[k]};' for k, v in var_names.items())
vars_ += ' --headerbar-bg-color: transparent; --headerbar-backdrop-color: transparent;'
B = ':not(.flat):not(.link):not(.titlebutton):not(.close):not(.minimize):not(.maximize):not(.suggested-action):not(.destructive-action)'
W = 'window' + NOT_FILES
# menus and popovers (Files' too): the shell menus' glass, drawn behind them by the patched Blur My
# Shell; no fill and no edge of their own (the glass's rim light is the only edge, docs/STANDARD.md),
# the menu radius and padding, concentric rows with a soft hover (tokens/).
# The selectors outrank the theme's popover rules copied above (which would paint them opaque).
# The popover node itself is cleared too: it has the .background class, so the scoped window
# rule above gave it the window tint, a square over the whole popup, arrow strip included.
# The theme's 1 px border on contents and arrow and its focus ring on the first row are cleared:
# with them the menu read as a second box inside the glass (docs/GLASS_MENUS_PLAN.md, Phase 0).
extra = f"""{W} {{ {vars_} }}
window.csd{NOT_FILES}, window.csd{NOT_FILES}:backdrop {{ outline: 1px solid {T['outline']}; outline-offset: -1px; }}
window.csd.maximized, window.csd.fullscreen, window.csd.tiled {{ outline: none; }}
{W} button{B} {{ background-color: {T['fill']}; background-image: none; box-shadow: inset 0 0 0 1px {T['rim']}; }}
{W} button{B}:hover {{ background-color: {T['hover']}; }}
{W} button{B}:active, {W} button{B}:checked {{ background-color: {T['press']}; }}
window:not(.tahoe-glass) popover.background:not(.magnifier) > contents, window:not(.tahoe-glass) popover.background:not(.magnifier) > contents:backdrop, window:not(.tahoe-glass) popover.menu.background:not(.magnifier) > contents, window:not(.tahoe-glass) popover.menu.background:not(.magnifier) > contents:backdrop {{ background-color: transparent; background-image: none; border: none; border-radius: {menu_r}px; padding: {menu_gap}px; box-shadow: none; }}
window:not(.tahoe-glass) popover.background:not(.magnifier) > contents stack scrolledwindow:not(.view) > viewport {{ background-color: transparent; }}
window:not(.tahoe-glass) popover.background:not(.magnifier), window:not(.tahoe-glass) popover.background:not(.magnifier):backdrop {{ background-color: transparent; background-image: none; }}
window:not(.tahoe-glass) popover.background:not(.magnifier) > arrow, window:not(.tahoe-glass) popover.menu.background:not(.magnifier) > arrow {{ background-color: transparent; background-image: none; border: none; }}
window popover.menu modelbutton, window popover.menu modelbutton.flat {{ border-radius: {menu_row}px; }}
window popover.menu modelbutton:focus {{ box-shadow: none; outline: none; }}
window popover.menu modelbutton:hover, window popover.menu modelbutton:selected {{ background-color: {row_hover}; }}
window popover.menu modelbutton:active {{ background-color: {row_pressed}; }}
window popover.menu.background separator, window popover.background > contents separator {{ background-color: {separator}; margin: 4px 10px; }}"""
block = '\n'.join([begin, f'/* mode: {mode}; menus: glass; {len(out)} theme rules scoped to every window but Files */',
                   *out, extra, end])
open(path, 'a').write('\n' + block + '\n')
print(f'  GTK4 glass ({mode}): {len(out)} theme rules scoped, Files excluded')
PY
}

# shell_overrides: config/gnome-shell-overrides.css rendered with the tokens (scripts/glass-tokens.py)
# into both shell themes: MacTahoe Light with the light mode's colours, MacTahoe Dark with the dark
# or milky mode's. Replaces the marked block, so a rerun picks up new rules. Prints 'changed' when
# a theme file was rewritten (the caller reloads the shell theme).
shell_overrides() {
  local mode dark_mode f; mode=$(glass_mode)
  dark_mode=$([ "$mode" = light ] && echo dark || echo "$mode")
  for f in Dark:"$dark_mode" Light:light; do
    local css="$HOME/.themes/MacTahoe-${f%%:*}/gnome-shell/gnome-shell.css"
    [ -f "$css" ] || continue
    python3 "$TOKENS_PY" render "$OVERRIDES_CSS" "${f#*:}" | python3 -c '
import re, sys
p = sys.argv[1]; ov = sys.stdin.read().strip()
css = open(p).read()
m = re.search(r"/\* tahoe-overrides:.*?/\* end tahoe-overrides \*/", css, flags=re.S)
if m and m.group(0).strip() == ov:
    sys.exit(0)
css = re.sub(r"\n*/\* tahoe-overrides:.*?/\* end tahoe-overrides \*/\n?", "\n", css, flags=re.S)
open(p, "w").write(css.rstrip() + "\n\n" + ov + "\n")
print("changed")' "$css"
  done
}

# shell_theme MODE: Tahoe puts dark text on light glass, so light mode uses the MacTahoe Light
# shell theme (with the same overrides as Dark, in the light mode's colours) and dark text on
# the top bar; dark and milky keep MacTahoe Dark and white text.
shell_theme() {
  local light_css="$HOME/.themes/MacTahoe-Light/gnome-shell/gnome-shell.css"
  local OBS="$EXT/openbar@neuromorph/schemas" name=MacTahoe-Dark fg="['1.0', '1.0', '1.0']"
  shell_overrides >/dev/null
  if [ "$1" = light ] && [ -f "$light_css" ]; then
    name=MacTahoe-Light; fg="['0.11', '0.11', '0.12']"
  fi
  # the theme is read again only when its name changes
  gsettings set org.gnome.shell.extensions.user-theme name '' 2>/dev/null && sleep 1
  gsettings set org.gnome.shell.extensions.user-theme name "$name" 2>/dev/null ||
    gsettings --schemadir /usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/schemas \
      set org.gnome.shell.extensions.user-theme name "$name"
  if [ -d "$OBS" ]; then
    gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar light-fgcolor "$fg"
    gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar fgcolor "$fg"
  fi
}

# gtk_theme MODE: the theme pair and colour scheme for the mode (light: MacTahoe Light)
gtk_theme() {
  if [ "$1" = light ]; then
    ln -sfn "$GTK4_DIR/gtk-Light.css" "$GTK4_DIR/gtk.css"
    gsettings set org.gnome.desktop.interface gtk-theme 'MacTahoe-Light-solid'
    gsettings set org.gnome.desktop.interface color-scheme 'default'
  else
    ln -sfn "$GTK4_DIR/gtk-Dark.css" "$GTK4_DIR/gtk.css"
    gsettings set org.gnome.desktop.interface gtk-theme 'MacTahoe-Dark-solid'
    gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'
  fi
}

# The glass edge per mode: Tahoe light has a bright rim, dark a quiet one; milky the bar's 12 %.
glass_edge_alpha() { python3 "$TOKENS_PY" get edge_alpha "$(glass_mode)"; }

# bms_radii: Blur My Shell's corner radius keys from tokens/radius.json (menus, quick settings
# submenus, calendar, notifications, app windows), so the glass has the CSS shape's radius
bms_radii() {
  local section key value
  while read -r section key value; do
    gsettings --schemadir "$EXT/$BMS_UUID/schemas" set "org.gnome.shell.extensions.blur-my-shell.$section" "$key" "$value"
  done < <(python3 "$TOKENS_PY" bms)
}

# shell_edges: set the edge in the installed Blur My Shell glass stylesheet (menus, quick settings
# pieces, dock) and on the top bar (Open Bar's border); only the glass part of the stylesheet changes
shell_edges() {
  local a; a=$(glass_edge_alpha)
  python3 - "$EXT/$BMS_UUID/stylesheet.css" "$a" <<'PY'
import re, sys
p, a = sys.argv[1], sys.argv[2]
s = open(p).read()
marker = '/* tahoe glass (cachyos-tahoe-theme)'
if marker in s:
    i = s.index(marker)
    glass = re.sub(r'border(-color)?: (1px solid )?rgba\(255, 255, 255, 0\.(12|08|25|16)\)',
                   lambda m: f"border{m.group(1) or ''}: {m.group(2) or ''}rgba(255, 255, 255, {a})", s[i:])
    open(p, 'w').write(s[:i] + glass)
PY
  local OBS="$EXT/openbar@neuromorph/schemas"
  [ -d "$OBS" ] && gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar balpha "$a"
}

# gtk3_glass light | dark | off: GTK3 apps (Disks, pywebview apps such as vut-map, ...) keep the
# solid theme, so their header bars were opaque. A marked block in the user GTK3 stylesheet makes
# the window background the GTK4 glass layer's (the window token over the live blur) and the
# header bar clear over it, with Tahoe's hairline under it. Content views keep the theme's fill.
# Context menus (popup windows of their own) are glass like the shell menus: the patched Blur My
# Shell draws it behind them. Popovers are drawn inside their window in GTK3, so they keep their
# fill. User CSS outranks the theme in GTK3.
GTK3_CSS="$HOME/.config/gtk-3.0/gtk.css"
GTK3_BEGIN='/* tahoe-glass-gtk3: managed by glass-bar.sh */'
GTK3_END='/* end tahoe-glass-gtk3 */'
gtk3_glass() {
  python3 - "$GTK3_CSS" "$GTK3_BEGIN" "$GTK3_END" <<'PY'
import sys
p, b, e = sys.argv[1:4]
try:
    s = open(p).read()
except FileNotFoundError:
    s = ''
while b in s and e in s:
    s = s[:s.index(b)].rstrip('\n') + '\n' + s[s.index(e) + len(e):].lstrip('\n')
open(p, 'w').write(s)
PY
  [ "$1" = off ] && return 0
  local win hair
  if [ "$1" = light ]; then win='rgba(250, 250, 252, 0.62)'; hair='rgba(0, 0, 0, 0.08)'
  else win='rgba(36, 36, 40, 0.62)'; hair='rgba(255, 255, 255, 0.08)'; fi
  # Liquid Glass tokens (docs/STANDARD.md): menu radius, padding and rows; the rim light is the only edge
  local r gap row; r=$(python3 "$TOKENS_PY" get app_menu.radius); gap=$(python3 "$TOKENS_PY" get app_menu.gap)
  row=$(python3 "$TOKENS_PY" get app_menu.row)
  local W='window.background.csd:not(.popup):not(.tooltip)' T='window.csd > .titlebar'
  cat >> "$GTK3_CSS" <<EOF

$GTK3_BEGIN
/* mode: $1 */
$W, $W:backdrop { background-color: $win; background-image: none; }
$T, $T:backdrop, $T headerbar, $T headerbar:backdrop, window.csd headerbar.titlebar, window.csd headerbar.titlebar:backdrop { background-color: transparent; background-image: none; border-bottom-color: transparent; box-shadow: inset 0 -1px $hair; }
window.csd.popup, window.csd.popup:backdrop, window.popup menu, window.popup .menu, window.popup .context-menu { background-color: transparent; background-image: none; }
window.csd.popup decoration, window.csd.popup:backdrop decoration { border-radius: ${r}px; background-color: transparent; box-shadow: none; border: none; }
window.popup menu, window.popup .menu, window.popup .context-menu { border-radius: ${r}px; padding: ${gap}px; border: none; box-shadow: none; }
window.popup menu menuitem, window.popup .menu menuitem { border-radius: ${row}px; outline: none; }
$GTK3_END
EOF
}

# the apps that get the live blur: every installed GTK3 and GTK4 app (scripts/glass-app-ids.py)
app_whitelist() { python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/glass-app-ids.py"; }

apps() { # on | off : live Liquid Glass behind the whitelisted app windows (Files, Settings, ...)
  local BS="$EXT/$BMS_UUID/schemas" S=org.gnome.shell.extensions.blur-my-shell.applications
  if [ "$1" = on ]; then
    gsettings --schemadir "$BS" set $S whitelist "$(app_whitelist)"
    # windows are large and full of text: the blur a step stronger than the menus' (24)
    glass_pipeline pipeline_glassbar_apps 'Glass apps' 24.0
    gsettings --schemadir "$BS" set $S blur true
    gsettings --schemadir "$BS" set $S static-blur false
    gsettings --schemadir "$BS" set $S pipeline pipeline_glassbar_apps
    # the theme rounds windows at 24 px (GTK4 window.csd, and Rounded Window Corners for the
    # rest; tokens/radius.json window.radius); square when maximised or fullscreen, as the windows are
    bms_radii
    gsettings --schemadir "$BS" set $S rounded-corners 0
    gsettings --schemadir "$BS" set $S corner-when-maximized false
    # light/dark: the GTK4 layer model makes the backgrounds translucent, so the window stays
    # fully opaque and its text crisp; milky keeps the window at 215 (84 %), as before modes
    local mode; mode=$(glass_mode)
    if [ "$mode" = milky ]; then
      gsettings --schemadir "$BS" set $S opacity 215
      gtk_glass off; gtk3_glass off
    else
      gsettings --schemadir "$BS" set $S opacity 255
      gtk_glass "$mode"; gtk3_glass "$mode"
    fi
  else
    restore_bms_section applications
    gtk_glass off; gtk3_glass off
  fi
  echo "  apps: $1"
}

menus() { # on | off : Blur My Shell's popup module
  local mode=$1 b cur
  b=$(readlink -f "$BACKUP")
  cur=$(mktemp)
  dconf dump "${EXT_PATH}blur-my-shell/" > "$cur"
  if [ "$mode" = on ]; then
    # the Tahoe VM's popup settings: v76 defaults (live blur, its own see-through menu style,
    # corner radii per surface), keeping every other Blur My Shell setting as it is
    # light mode: Blur My Shell's light menu style (dark text on light glass); otherwise automatic
    python3 - "$cur" "$([ "$(glass_mode)" = light ] && echo 1 || echo 3)" > "$cur.new" <<'PY'
import sys
out, sec = [], None
for line in open(sys.argv[1]):
    line = line.rstrip('\n')
    if line.startswith('['):
        sec = line
    elif sec == '[popup]':
        continue
    out.append(line)
out += ['', '[popup]', 'blur=true', 'static-blur=false', "pipeline='pipeline_default'",
        'override-background=true', 'preserve-shell-theme=false', 'style-popup=' + sys.argv[2]]
print('\n'.join(out))
PY
  else
    # popup section from the backup taken before 'apply'
    python3 - "$cur" "$b/extensions.dconf" > "$cur.new" <<'PY'
import sys
def sections(f, prefix=''):
    out, sec = {}, None
    for line in open(f):
        line = line.rstrip('\n')
        if line.startswith('['):
            sec = line
            out.setdefault(sec, [])
        elif sec and '=' in line:
            out[sec].append(line)
    return out
cur = sections(sys.argv[1])
old = sections(sys.argv[2])
cur['[popup]'] = old.get('[blur-my-shell/popup]', [])
for sec, lines in cur.items():
    print(sec); print('\n'.join(lines)); print()
PY
  fi
  dconf_apply "${EXT_PATH}blur-my-shell/" "$cur.new" "$cur"
  rm -f "$cur" "$cur.new"
  if [ "$mode" = on ]; then
    # the top bar's Liquid Glass recipe, its blur a step stronger at 18; a pipeline of its own
    # so the shared default (windows) stays as it is
    glass_pipeline pipeline_glassbar_menus 'Glass menus' 18.0
    # the overview's search result panels: the same glass, shaded more (the patched Blur My Shell
    # uses it for them when it exists)
    glass_pipeline pipeline_glassbar_search 'Glass search' 18.0 search
    gsettings --schemadir "$EXT/$BMS_UUID/schemas" set org.gnome.shell.extensions.blur-my-shell.popup pipeline pipeline_glassbar_menus
    # the app folder popup in the overview: the same Liquid Glass (its radius comes from the CSS)
    gsettings --schemadir "$EXT/$BMS_UUID/schemas" set org.gnome.shell.extensions.blur-my-shell.appfolder pipeline pipeline_glassbar_menus
    bms_radii
  else
    # the app folder's pipeline from before 'apply'
    local folder_pipe
    folder_pipe=$(sed -n '/^\[blur-my-shell\/appfolder\]/,/^\[/{s/^pipeline=//p}' "$b/extensions.dconf" | head -1)
    gsettings --schemadir "$EXT/$BMS_UUID/schemas" set org.gnome.shell.extensions.blur-my-shell.appfolder pipeline "${folder_pipe:-'pipeline_default'}"
  fi
  echo "  menus: $mode"
}

build_bms() {
  for c in git make msgfmt glib-compile-schemas; do command -v "$c" >/dev/null || { echo "missing tool: $c"; exit 1; }; done
  mkdir -p "$SRC"
  [ -d "$SRC/blur-my-shell/.git" ] || git clone -q https://github.com/aunetx/blur-my-shell.git "$SRC/blur-my-shell"
  git -C "$SRC/blur-my-shell" fetch -q origin
  # a checkout of our own, so it is reset to the pinned commit before patching
  git -C "$SRC/blur-my-shell" reset -q --hard "$BMS_COMMIT"
  git -C "$SRC/blur-my-shell" clean -fdq
  git -C "$SRC/blur-my-shell" apply "$BMS_PATCH"
  /usr/bin/make -C "$SRC/blur-my-shell" install >/dev/null
  # GNOME's update check sends each extension's version to extensions.gnome.org and installs
  # whatever it answers "upgrade" or "downgrade" with at the next login. Version 76 is not
  # published there, so it answers "downgrade" and the patched build is swapped for v75.
  # Labelled with the published version, the answer is "current" and the build stays.
  local shell_major ego_ver
  shell_major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
  ego_ver=$(curl -sf "https://extensions.gnome.org/extension-info/?uuid=$BMS_UUID&shell_version=$shell_major" |
            python3 -c 'import json,sys;print(json.load(sys.stdin).get("version",""))' || true)
  if [ -n "$ego_ver" ]; then
    python3 - "$EXT/$BMS_UUID/metadata.json" "$ego_ver" <<'PY'
import json, sys
p, v = sys.argv[1], int(sys.argv[2])
m = json.load(open(p))
m['tahoe-glass-built-from'] = m.get('version')
m['version'] = v
json.dump(m, open(p, 'w'), indent=2)
PY
    shell_edges
    echo "  built from v76 + $(basename "$BMS_PATCH"), labelled v$ego_ver (extensions.gnome.org's current) so GNOME does not swap it"
    if [ "$ego_ver" -ge 76 ]; then
      echo "  note: extensions.gnome.org now has v$ego_ver; GNOME may replace this build with it (dropping the patch)"
    fi
  else
    echo "  warning: could not read extensions.gnome.org; GNOME's update check may swap this build for the published one"
  fi
}

# a build GNOME replaced with the published version has no patch in it
check_bms() {
  if ! grep -q is_app_menu "$EXT/$BMS_UUID/components/applications/window_rules.js" 2>/dev/null; then
    echo "  Blur My Shell is not the patched build (GNOME's update check may have replaced it): run 'bash $0 rebuild'"
  fi
}

apply() {
  step "1/5 Backup of your current settings and Blur My Shell"
  ensure_backup

  step "2/5 Blur My Shell v76 (built from source)"
  build_bms

  step "3/5 Open Bar"
  local shell_major path tmp
  shell_major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
  path=$(curl -sf "https://extensions.gnome.org/extension-info/?uuid=$OPENBAR_UUID&shell_version=$shell_major" |
         python3 -c 'import json,sys;print(json.load(sys.stdin).get("download_url",""))')
  tmp=$(mktemp -d)
  curl -sfLo "$tmp/openbar.zip" "https://extensions.gnome.org$path"
  gnome-extensions install -f "$tmp/openbar.zip"
  # Open Bar is not marked GNOME 51 compatible; GNOME only loads it with version checks off
  gsettings set org.gnome.shell disable-extension-version-validation true
  gsettings set org.gnome.shell enabled-extensions "$(ext_list_add "$OPENBAR_UUID")"

  step "4/5 Open Bar: Tahoe's floating pill bar, everything else left to MacTahoe"
  curl -sfLo "$tmp/preset.dconf" "$OPENBAR_PRESET_URL"
  local dark light barfont
  # Open Bar sets the bar text itself unless given a font; Tahoe's menu bar is the system
  # font at regular weight, so hand Open Bar the interface font as it is
  barfont=$(gsettings get org.gnome.desktop.interface font-name | tr -d "'")
  echo "  bar font: $barfont"
  dark=$(gsettings get org.gnome.desktop.background picture-uri-dark)
  light=$(gsettings get org.gnome.desktop.background picture-uri)
  # keep the bar shape/colours from the preset; switch off every part that styles anything but the bar
  sed -e "s|^dark-bguri=.*|dark-bguri=$dark|" -e "s|^light-bguri=.*|light-bguri=$light|" \
      -e "s|^font=.*|font='$barfont'|" \
      -e "s|^fgcolor=.*|fgcolor=['1.0', '1.0', '1.0']|" -e "s|^fgalpha=.*|fgalpha=1.0|" \
      -e "s|^dark-fgcolor=.*|dark-fgcolor=['1.0', '1.0', '1.0']|" -e "s|^light-fgcolor=.*|light-fgcolor=['1.0', '1.0', '1.0']|" \
      -e "s|^menustyle=.*|menustyle=false|" \
      -e "s|^apply-menu-shell=.*|apply-menu-shell=false|" -e "s|^apply-menu-notif=.*|apply-menu-notif=false|" \
      -e "s|^apply-all-shell=.*|apply-all-shell=false|" -e "s|^apply-accent-shell=.*|apply-accent-shell=false|" \
      -e "s|^apply-gtk=.*|apply-gtk=false|" -e "s|^apply-flatpak=.*|apply-flatpak=false|" \
      -e "s|^gtk-popover=.*|gtk-popover=false|" -e "s|^set-yarutheme=.*|set-yarutheme=false|" \
      -e "s|^set-notifications=.*|set-notifications=false|" -e "s|^set-notif-position=.*|set-notif-position=false|" \
      -e "s|^set-overview=.*|set-overview=false|" \
      -e "s|^wmaxbar=.*|wmaxbar=false|" \
      "$tmp/preset.dconf" > "$tmp/openbar.dconf"
  dconf_apply "${EXT_PATH}openbar/" "$tmp/openbar.dconf"
  # the preset was exported with import-export=true, which pauses Open Bar's restyling; clear it and reload
  dconf write "${EXT_PATH}openbar/import-export" false
  if [ "$(dconf read "${EXT_PATH}openbar/trigger-reload")" = true ]; then t=false; else t=true; fi
  dconf write "${EXT_PATH}openbar/trigger-reload" "$t"
  rm -rf "$tmp"

  step "5/5 Top bar: rounded static blur with Liquid Glass"
  bar_blur glass
  set_state enabled 1
  set_state bar glass
  grep -q '^menus=' "$STATE" || set_state menus off

  step "Done. LOG OUT AND BACK IN now (the new Blur My Shell and Open Bar load at login)."
  echo "  To undo everything: bash $0 undo"
}

undo() {
  [ -e "$BACKUP/extensions.dconf" ] || { echo "no backup found at $BACKUP"; exit 1; }
  local b
  b=$(readlink -f "$BACKUP")
  step "Restoring from $b"
  # extension list first, so Open Bar stops before its settings are removed
  gsettings set org.gnome.shell enabled-extensions "$(cat "$b/enabled-extensions.txt")"
  gsettings set org.gnome.shell disabled-extensions "$(cat "$b/disabled-extensions.txt")"
  gsettings set org.gnome.shell disable-extension-version-validation \
    "$(python3 - "$b/org-gnome.dconf" <<'PY'
import sys
sec = None
val = 'false'
for line in open(sys.argv[1]):
    line = line.strip()
    if line.startswith('['): sec = line
    elif sec == '[shell]' and line.startswith('disable-extension-version-validation='): val = line.split('=', 1)[1]
print(val)
PY
)"
  if ! grep -q "^$OPENBAR_UUID " "$b/extension-versions.txt"; then
    gnome-extensions uninstall "$OPENBAR_UUID" 2>/dev/null || true
    dconf reset -f "${EXT_PATH}openbar/"   # one path reset, not 285 key changes
  fi
  if [ -d "$b/$BMS_UUID-v75" ]; then
    rm -rf "$EXT/$BMS_UUID"
    cp -a "$b/$BMS_UUID-v75" "$EXT/$BMS_UUID"
    echo "  Blur My Shell v75 files restored"
  fi
  local cur
  cur=$(mktemp)
  dconf dump "$EXT_PATH" > "$cur"
  dconf_apply "$EXT_PATH" "$b/extensions.dconf" "$cur"
  rm -f "$cur"
  gtk_glass off; gtk3_glass off   # the GTK4 and GTK3 glass blocks, if 'apps on' added them
  rm -f "$STATE"
  step "Done. LOG OUT AND BACK IN to finish going back."
}

case "${1:-}" in
  apply) apply ;;
  undo) undo ;;
  status) check_bms; echo "  installed: $(python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print("v%s (built from v%s)" % (m["version"], m.get("tahoe-glass-built-from", m["version"])))' "$EXT/$BMS_UUID/metadata.json")" ;;
  apps)
    case "${2:-}" in
      on|off) apps "$2"; set_state apps "$2" ;;
      *) echo "usage: apps on|off"; exit 1 ;;
    esac ;;
  dock)
    case "${2:-}" in
      on|off) dock "$2"; set_state dock "$2" ;;
      *) echo "usage: dock on|off"; exit 1 ;;
    esac ;;
  mode|tint)
    m="${2:-}"
    [ "$1" = tint ] && [ "$m" = light ] && m=milky   # 'tint light' was the milky look
    case "$m" in
      light|dark|milky)
        set_state mode "$m"
        gtk_theme "$([ "$m" = light ] && echo light || echo dark)"
        shell_theme "$m"
        # every glass surface that is on, from the one recipe
        [ "$(sed -n 's/^bar=//p' "$STATE" | tail -1)" = plain ] || bar_blur glass
        if [ "$(sed -n 's/^menus=//p' "$STATE" | tail -1)" = on ]; then menus on >/dev/null; fi
        if [ "$(sed -n 's/^dock=//p' "$STATE" | tail -1)" = on ]; then glass_pipeline pipeline_glassbar_dock 'Glass dock' 18.0; fi
        if [ "$(sed -n 's/^apps=//p' "$STATE" | tail -1)" = on ]; then apps on; fi
        shell_edges
        # reload Blur My Shell so its stylesheet (the edges) is read again
        # (and put the extension list back in its order, which disable/enable changes)
        order=$(gsettings get org.gnome.shell enabled-extensions)
        gnome-extensions disable "$BMS_UUID"; sleep 1; gnome-extensions enable "$BMS_UUID"
        sleep 1; gsettings set org.gnome.shell enabled-extensions "$order"
        echo "  mode: $m (apps opened before this pick it up when reopened)" ;;
      *) echo "usage: mode light|dark|milky"; exit 1 ;;
    esac ;;
  rebuild) step "Blur My Shell v76, patched"; build_bms; step "Done. LOG OUT AND BACK IN to load it." ;;
  radii) bms_radii; echo "  Blur My Shell radii: from tokens/radius.json" ;;
  overrides)  # the shell CSS overrides, rendered with the tokens, into both shell themes
    if [ -n "$(shell_overrides)" ]; then
      name=$(gsettings get org.gnome.shell.extensions.user-theme name | tr -d "'")
      gsettings set org.gnome.shell.extensions.user-theme name ''; sleep 1
      gsettings set org.gnome.shell.extensions.user-theme name "$name"
      echo "  shell overrides: re-applied"
    fi ;;
  menus)
    case "${2:-}" in
      on|off) menus "$2"; set_state menus "$2" ;;
      *) echo "usage: menus on|off"; exit 1 ;;
    esac ;;
  glass)
    case "${2:-}" in
      on) bar_blur glass; set_state bar glass ;;
      off) bar_blur plain; set_state bar plain ;;
      *) echo "usage: glass on|off"; exit 1 ;;
    esac ;;
  *) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
