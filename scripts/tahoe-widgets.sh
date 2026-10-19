#!/usr/bin/env bash
# Tahoe Liquid Glass widgets on the desktop (extensions/tahoe-widgets@cachyos-tahoe).
# They draw their glass with the patched Blur My Shell that glass-bar.sh installs, follow its
# light/dark/milky mode, and never touch the top bar. Everything stays in your home folder.
#
#   bash tahoe-widgets.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-widgets.sh off     switch off (instant); the files stay
#   bash tahoe-widgets.sh status
#
# tahoe-repair keeps the widgets enabled while they are installed and switched on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-widgets@cachyos-tahoe
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
    set_state widgets on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login."
    else
      echo "Updated. Code changes load at the next login; the running widgets keep the old code."
    fi ;;
  off)
    set_state widgets off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Widgets off." ;;
  status)
    echo "installed: $([[ -d "$DEST" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^widgets=//p' "$STATE" 2>/dev/null | tail -1)"
    gnome-extensions info "$UUID" 2>/dev/null | grep State: || echo "shell: not loaded" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
