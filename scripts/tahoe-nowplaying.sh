#!/usr/bin/env bash
# Tahoe Now Playing (extensions/tahoe-nowplaying@cachyos-tahoe): a full-screen Now Playing view over
# the desktop, opened with Super+Shift+M (settings key `toggle`): the cover forming from a drop of
# Liquid Glass, the album-colour swirl, the lock screen's glass clock and live synced lyrics. Escape,
# the hotkey again, the chevron, a click outside the controls or almost any key returns to the
# desktop. See docs/NOWPLAYING_PLAN.md. Everything stays in your home folder.
#
#   bash tahoe-nowplaying.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-nowplaying.sh off     switch off (instant); the files stay
#   bash tahoe-nowplaying.sh status
#
# Change the hotkey:
#   gsettings --schemadir ~/.local/share/gnome-shell/extensions/tahoe-nowplaying@cachyos-tahoe/schemas \
#     set org.gnome.shell.extensions.tahoe-nowplaying toggle "['<Super><Shift>m']"
# tahoe-repair keeps it enabled while it is installed and switched on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-nowplaying@cachyos-tahoe
SRC="$ROOT/extensions/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
STATE="$HOME/.config/tahoe-glass/state"

set_state() { # key value
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  if grep -q "^$1=" "$STATE"; then sed -i "s|^$1=.*|$1=$2|" "$STATE"; else echo "$1=$2" >> "$STATE"; fi
}
# enabled-extensions with UUID added (add) or removed (remove)
ext_list() {
  python3 -c 'import ast,sys
l = ast.literal_eval(sys.argv[1] or "[]")
l = [e for e in l if e != sys.argv[3]] + ([sys.argv[3]] if sys.argv[2] == "add" else [])
print(l)' "$(gsettings get org.gnome.shell enabled-extensions | sed 's/^@as //')" "$1" "$UUID"
}

case "${1:-}" in
  on)
    # the extension carries copies of the widgets', lock screen's and motion's modules: refuse to
    # install a stale copy
    bash "$ROOT/tools/nowplaying/check-shared.sh"
    [[ "$(fc-match -f '%{family}' 'SF Pro Text')" == *"SF Pro"* ]] ||
      echo "Note: SF Pro is not installed (scripts/sf-fonts.sh); the controls fall back to the icon theme's symbols."
    new=0; [[ -d "$DEST" ]] || new=1
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp -r "$SRC/." "$DEST/"
    glib-compile-schemas "$DEST/schemas"
    set_state nowplaying on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login. Then Super+Shift+M."
    else
      echo "Updated. Code changes load at the next login; the running shell keeps the old code."
    fi ;;
  off)
    set_state nowplaying off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Tahoe Now Playing off (the hotkey does nothing until it is switched on again)." ;;
  status)
    echo "installed: $([[ -d "$DEST" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^nowplaying=//p' "$STATE" 2>/dev/null | tail -1)"
    gnome-extensions info "$UUID" 2>/dev/null | grep State: || echo "shell: not loaded (loads at the next login)" ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
