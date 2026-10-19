#!/usr/bin/env bash
# macOS Tahoe's Control Center in place of quick settings (extensions/tahoe-control-center@cachyos-tahoe).
# Its pieces draw their glass with the patched Blur My Shell that glass-bar.sh installs (the glass
# menus pipeline), follow its light/dark/milky mode. Everything stays in your home folder.
#
#   bash tahoe-control-center.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-control-center.sh off     switch off (instant); the files stay
#   bash tahoe-control-center.sh status
#
# tahoe-repair keeps the Control Center enabled while they are installed and switched on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-control-center@cachyos-tahoe
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
    new=0; [[ -d "$DEST" ]] || new=1
    mkdir -p "$DEST"
    cp -r "$SRC/." "$DEST/"
    set_state controlcenter on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login."
    else
      echo "Updated. Code changes load at the next login; the running panel keeps the old code."
    fi ;;
  off)
    set_state controlcenter off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Control Center off: GNOME's quick settings are back." ;;
  status)
    echo "installed: $([[ -d "$DEST" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^controlcenter=//p' "$STATE" 2>/dev/null | tail -1)"
    gnome-extensions info "$UUID" 2>/dev/null | grep State: || echo "shell: not loaded" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
