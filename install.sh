#!/usr/bin/env bash
# install.sh: Liquid Glass on GNOME 51 (Wayland). Everything goes into your home folder; no sudo.
#
#   ./install.sh --check       what is missing (and the pacman line to fix it); changes nothing
#   ./install.sh               install, then LOG OUT AND BACK IN
#   ./install.sh --uninstall   put back the settings from before the install, remove what it added
#
# Options: TAHOE_MODE=light|dark|milky (default dark), TAHOE_LOCKSCREEN=0 (skip the lock screen),
# TAHOE_FIREFOX=1 (also theme Firefox, as MacTahoe does), TAHOE_FAVORITES=1 (the author's dock apps).
# The login screen is a separate, sudo step: bash scripts/gdm-theme.sh install. README: Install.
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
SRC="$HOME/.local/src"
ICONS_REPO=https://github.com/Blanchedubois/cachyos-tahoe-theme
ICONS_SRC="$SRC/cachyos-tahoe-theme"
OWN="$HOME/.local/share/liquid-glass-install"
STATE="$HOME/.config/tahoe-glass/state"
EXT="$HOME/.local/share/gnome-shell/extensions"
TESTED_SHELL=51

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m       %s\n' "$*"; }
miss() { printf '  \033[31mmissing\033[0m  %s\n' "$*"; }
note() { printf '  \033[33mnote\033[0m     %s\n' "$*"; }

# ---- check -------------------------------------------------------------------------------------
# package name, the command or file that shows it is there
NEEDED=(
  "gnome-shell:gnome-shell"
  "gnome-shell-extensions:/usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json"
  "git:git" "make:make" "gettext:msgfmt" "glib2:glib-compile-schemas" "curl:curl" "unzip:unzip"
  "python-gobject:python-gi" "sassc:sassc"
)
check() {
  local bad=0 pkgs=() p what
  say "Checking this machine"
  [[ "$(id -u)" != 0 ]] && ok "running as yourself" || { miss "run as yourself, not root"; bad=1; }
  local ver; ver="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)*' | head -1 || true)"
  if [[ "${ver%%.*}" == "$TESTED_SHELL" ]]; then ok "GNOME Shell $ver"
  elif [[ -n "$ver" ]]; then miss "GNOME Shell $ver: this release is built for GNOME $TESTED_SHELL"; bad=1
  else miss "GNOME Shell (not installed)"; bad=1; fi
  if [[ "${XDG_SESSION_TYPE:-}" == wayland && "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]]; then ok "a GNOME Wayland session"
  else miss "run this from a terminal inside a GNOME Wayland session (now: ${XDG_CURRENT_DESKTOP:-none}, ${XDG_SESSION_TYPE:-none})"; bad=1; fi
  command -v pacman >/dev/null && ok "pacman (Arch-based)" || note "no pacman: install the packages below with your package manager (untested)"
  for p in "${NEEDED[@]}"; do
    what=${p#*:}; p=${p%%:*}
    if [[ "$what" == python-gi ]]; then python3 -c 'import gi' 2>/dev/null && ok "$p" && continue
    elif [[ "$what" == /* ]]; then [[ -e "$what" ]] && ok "$p" && continue
    else command -v "$what" >/dev/null && ok "$p" && continue; fi
    miss "$p"; pkgs+=("$p"); bad=1
  done
  [[ -n "$(fc-list 'SF Pro Text' family 2>/dev/null)" ]] && ok "SF Pro" ||
    note "SF Pro not installed (optional): download SF-Pro.dmg from https://developer.apple.com/fonts/, then bash scripts/sf-fonts.sh"
  [[ -n "$(fc-list 'Space Grotesk' family 2>/dev/null)" ]] && ok "Space Grotesk" ||
    note "Space Grotesk not installed (optional, the lock screen clock): from https://fonts.google.com/specimen/Space+Grotesk (OFL) into ~/.local/share/fonts"
  curl -sfI https://extensions.gnome.org >/dev/null && ok "network (extensions.gnome.org)" || { miss "network: extensions.gnome.org unreachable"; bad=1; }
  if (( ${#pkgs[@]} )); then echo; echo "  To fix: sudo pacman -S --needed ${pkgs[*]}"; fi
  return $bad
}

# ---- settings backup and restore (in batches: 256+ keys in one change abort GNOME Shell) ---------
dconf_restore() { # DUMP: the /org/gnome/ settings back as they were in DUMP; keys added since are reset
  local cur; cur=$(mktemp); dconf dump /org/gnome/ > "$cur"
  python3 - "$1" "$cur" <<'PY'
import subprocess, sys
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
old, cur = parse(sys.argv[1]), parse(sys.argv[2])
writes = [(s, k, v) for (s, k), v in old.items() if cur.get((s, k)) != v]
resets = [(s, k) for (s, k) in cur if (s, k) not in old]
for s, k in resets:
    subprocess.run(['dconf', 'reset', '/org/gnome/' + ('' if s == '/' else s + '/') + k])
for i in range(0, len(writes), 100):
    chunk, last = [], None
    for s, k, v in writes[i:i + 100]:
        if s != last:
            chunk.append(f'[{s}]'); last = s
        chunk.append(f'{k}={v}')
    subprocess.run(['dconf', 'load', '/org/gnome/'], input='\n'.join(chunk) + '\n', text=True, check=True)
print(f'  {len(writes)} settings restored, {len(resets)} reset')
PY
  rm -f "$cur"
}

# what existed before the install, so the uninstall removes only what it added
snapshot() {
  local d="$OWN/before"; mkdir -p "$d"
  dconf dump /org/gnome/ > "$d/org-gnome.dconf"
  { ls -1 "$HOME/.themes" 2>/dev/null | sed 's|^|theme |'
    ls -1 "$EXT" 2>/dev/null | sed 's|^|extension |'
    ls -1 "$HOME/.local/share/icons" 2>/dev/null | sed 's|^|icons |'
    [[ -e "$HOME/.config/gtk-4.0" ]] && echo "gtk4"
    [[ -e "$HOME/.config/gtk-3.0/gtk.css" ]] && echo "gtk3css"; } > "$d/files.txt"
  for f in "$HOME/.config/gtk-3.0/gtk.css"; do [[ -f "$f" ]] && cp -a "$f" "$d/"; done
  [[ -d "$HOME/.config/gtk-4.0" ]] && cp -a "$HOME/.config/gtk-4.0" "$d/gtk-4.0"
  date -Is > "$d/when"
}

set_state() {
  mkdir -p "$(dirname "$STATE")"; touch "$STATE"
  if grep -q "^$1=" "$STATE"; then sed -i "s|^$1=.*|$1=$2|" "$STATE"; else echo "$1=$2" >> "$STATE"; fi
}

# ---- install -----------------------------------------------------------------------------------
install() {
  check || { echo; echo "Fix the missing items above, then run ./install.sh again."; exit 1; }
  local mode="${TAHOE_MODE:-dark}"
  if [[ -e "$OWN/before/when" ]]; then
    say "A previous install is recorded ($(cat "$OWN/before/when")): updating it, the first backup stays"
  else
    say "1/7 Backing up your current settings ($OWN/before)"; snapshot
  fi

  say "2/7 Tahoe-Material icons (from cachyos-tahoe-theme, the icons folder only)"
  mkdir -p "$SRC"
  if [[ ! -d "$ICONS_SRC/.git" ]]; then
    git clone -q --depth 1 --filter=blob:none --sparse "$ICONS_REPO" "$ICONS_SRC"
    git -C "$ICONS_SRC" sparse-checkout set icons
  else
    git -C "$ICONS_SRC" pull -q --ff-only || note "could not update the icons; keeping the copy there"
  fi

  say "3/7 MacTahoe theme, extensions and GNOME settings (scripts/gnome-setup.sh)"
  TAHOE_ICONS="$ICONS_SRC/icons" bash "$ROOT/scripts/gnome-setup.sh"

  say "4/7 Liquid Glass: patched Blur My Shell, the floating bar (scripts/glass-bar.sh apply)"
  set_state mode "$mode"
  bash "$ROOT/scripts/glass-bar.sh" apply
  say "5/7 Glass menus, dock and apps"
  bash "$ROOT/scripts/glass-bar.sh" menus on
  bash "$ROOT/scripts/glass-bar.sh" dock on
  bash "$ROOT/scripts/glass-bar.sh" apps on

  say "6/7 Widgets, motion and the lock screen"
  bash "$ROOT/scripts/tahoe-widgets.sh" on
  bash "$ROOT/scripts/tahoe-motion.sh" on
  if [[ "${TAHOE_LOCKSCREEN:-1}" == 1 ]]; then bash "$ROOT/scripts/tahoe-lockscreen.sh" on; fi
  [[ -f "$HOME/Downloads/SF-Pro.dmg" && -z "$(fc-list 'SF Pro Text' family)" ]] && command -v 7z >/dev/null &&
    bash "$ROOT/scripts/sf-fonts.sh" "$HOME/Downloads/SF-Pro.dmg"

  say "7/7 tahoe-repair at every login, and a first check"
  bash "$ROOT/scripts/tahoe-repair.sh" check >/dev/null 2>&1 || true
  echo
  say "Done. LOG OUT AND BACK IN: GNOME on Wayland loads the new extensions only at login."
  echo "  At that login tahoe-repair finishes the look ($mode mode) and keeps it from then on."
  echo "  Optional: SF Pro (bash scripts/sf-fonts.sh), the login screen (bash scripts/gdm-theme.sh install, sudo)."
  echo "  To remove it all: ./install.sh --uninstall"
}

# ---- uninstall ---------------------------------------------------------------------------------
uninstall() {
  local d="$OWN/before"
  [[ -e "$d/when" ]] || { echo "No install recorded in $OWN; nothing to undo."; exit 1; }
  say "Switching the Tahoe extensions off"
  for s in tahoe-lockscreen tahoe-motion tahoe-widgets tahoe-menu-bar tahoe-control-center; do
    bash "$ROOT/scripts/$s.sh" off >/dev/null 2>&1 || true
  done
  say "Removing the repair's login hook"
  rm -f "$HOME/.config/autostart/tahoe-repair.desktop"
  [[ "$(readlink "$HOME/.local/bin/tahoe-repair" 2>/dev/null)" == "$ROOT/"* ]] && rm -f "$HOME/.local/bin/tahoe-repair"
  say "Liquid Glass off: Blur My Shell and its settings as before (scripts/glass-bar.sh undo)"
  bash "$ROOT/scripts/glass-bar.sh" undo || note "glass-bar.sh undo had nothing to restore"
  say "Your GNOME settings as before the install"
  dconf_restore "$d/org-gnome.dconf"
  say "Removing what the install added"
  local u
  for u in "$EXT"/*; do
    u=$(basename "$u")
    grep -qx "extension $u" "$d/files.txt" || { rm -rf "${EXT:?}/$u"; echo "  removed extension $u"; }
  done
  for u in "$HOME"/.themes/MacTahoe*; do
    [[ -e "$u" ]] || continue
    grep -qx "theme $(basename "$u")" "$d/files.txt" || { rm -rf "$u"; echo "  removed theme $(basename "$u")"; }
  done
  for u in "$HOME"/.local/share/icons/*; do
    [[ -e "$u" || -L "$u" ]] || continue
    grep -qx "icons $(basename "$u")" "$d/files.txt" || { rm -rf "$u"; echo "  removed icons $(basename "$u")"; }
  done
  if [[ -f "$d/gtk.css" ]]; then cp -a "$d/gtk.css" "$HOME/.config/gtk-3.0/gtk.css"; else rm -f "$HOME/.config/gtk-3.0/gtk.css"; fi
  rm -rf "$HOME/.config/gtk-4.0"; [[ -d "$d/gtk-4.0" ]] && cp -a "$d/gtk-4.0" "$HOME/.config/gtk-4.0"
  rm -rf "$HOME/.config/tahoe-glass"
  mv "$OWN" "$OWN.removed-$(date +%Y%m%d-%H%M%S)"
  say "Done. LOG OUT AND BACK IN. (Sources stay in $SRC; the login screen, if installed: bash scripts/gdm-theme.sh undo)"
}

case "${1:-}" in
  --check) check ;;
  --uninstall) uninstall ;;
  "") install ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
