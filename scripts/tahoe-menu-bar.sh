#!/usr/bin/env bash
# macOS Tahoe menu bar contents on the top bar (docs/gnome-tahoe/menu-bar-control-center.md):
#   - the Apple menu: Kiwi Menu (kiwimenu@kemma, from extensions.gnome.org) at the left, with the
#     Apple logo, Activities hidden
#   - the clock with the weekday ("Mon Oct 19  7:28 PM"), GNOME's own setting
#   - extensions/tahoe-menu-bar@cachyos-tahoe: one Control Center glyph in place of the quick
#     settings indicator icons, and a Focus moon while Do Not Disturb is on
# Everything stays in your home folder.
#
#   bash tahoe-menu-bar.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-menu-bar.sh off     switch off (instant); the files stay
#   bash tahoe-menu-bar.sh status
#
# tahoe-repair keeps both extensions enabled while installed and switched on (state key menubar=on).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-menu-bar@cachyos-tahoe
KIWI=kiwimenu@kemma
SRC="$ROOT/extensions/$UUID"
EXT="$HOME/.local/share/gnome-shell/extensions"
STATE="$HOME/.config/tahoe-glass/state"

set_state() { # key value
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  if grep -q "^$1=" "$STATE"; then sed -i "s|^$1=.*|$1=$2|" "$STATE"; else echo "$1=$2" >> "$STATE"; fi
}
# enabled-extensions with the given uuids added (add) or removed (remove)
ext_list() {
  python3 -c 'import ast,sys
l = ast.literal_eval(sys.argv[1] or "[]"); uuids = sys.argv[3:]
l = [e for e in l if e not in uuids] + (uuids if sys.argv[2] == "add" else [])
print(l)' "$(gsettings get org.gnome.shell enabled-extensions | sed 's/^@as //')" "$1" "$UUID" "$KIWI"
}
install_kiwi() {
  local shell_major path tmp
  shell_major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
  path=$(curl -sf "https://extensions.gnome.org/extension-info/?uuid=$KIWI&shell_version=$shell_major" |
         python3 -c 'import json,sys;print(json.load(sys.stdin).get("download_url",""))')
  [[ -n "$path" ]] || { echo "Kiwi Menu: no build for GNOME $shell_major on extensions.gnome.org"; return 1; }
  tmp=$(mktemp -d)
  curl -sfLo "$tmp/kiwimenu.zip" "https://extensions.gnome.org$path"
  gnome-extensions install -f "$tmp/kiwimenu.zip"
  rm -rf "$tmp"
  fix_kiwi
}
# Kiwi Menu v34's user switcher (shown when the machine has several user accounts) still uses
# St.BoxLayout's 'vertical' property, which GNOME 51 removed; the same one-word change its
# other files already made
fix_kiwi() {
  sed -i 's/\bvertical: true,/orientation: Clutter.Orientation.VERTICAL,/' "$EXT/$KIWI/src/userSwitcher.js"
}

case "${1:-}" in
  on)
    new=0; [[ -d "$EXT/$UUID" && -d "$EXT/$KIWI" ]] || new=1
    [[ -d "$EXT/$KIWI" ]] || install_kiwi
    fix_kiwi
    mkdir -p "$EXT/$UUID"
    cp -r "$SRC/." "$EXT/$UUID/"
    K="gsettings --schemadir $EXT/$KIWI/schemas set org.gnome.shell.extensions.kiwimenu"
    $K icon 10                            # the Apple logo
    $K activity-menu-visibility false     # macOS has no Activities button
    gsettings set org.gnome.desktop.interface clock-show-weekday true
    set_state menubar on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login."
    else
      echo "Updated. Code changes load at the next login."
    fi ;;
  off)
    set_state menubar off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Menu bar extras off (the clock keeps its weekday; gsettings reset org.gnome.desktop.interface clock-show-weekday to drop it)." ;;
  status)
    echo "installed: $([[ -d "$EXT/$UUID" ]] && echo yes || echo no), Kiwi Menu: $([[ -d "$EXT/$KIWI" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^menubar=//p' "$STATE" 2>/dev/null | tail -1)"
    for u in "$UUID" "$KIWI"; do gnome-extensions info "$u" 2>/dev/null | grep State: || echo "$u: not loaded"; done ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
