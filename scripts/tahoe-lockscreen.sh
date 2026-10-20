#!/usr/bin/env bash
# Tahoe lock screen (extensions/tahoe-lockscreen@cachyos-tahoe): the Liquid Glass clock, Now
# Playing with the album-colour swirl, the Tahoe layout and glass on the top-right menu, all on
# GNOME's own unlock dialog. The extension runs only while the screen is locked; GNOME's prompt
# and password check stay GNOME's, and on any fault it puts back GNOME's own lock screen.
# See docs/LOCKSCREEN_PLAN.md. Everything stays in your home folder.
#
#   bash tahoe-lockscreen.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-lockscreen.sh off     switch off (instant); the files stay
#   bash tahoe-lockscreen.sh status
#
# If the lock screen ever looks wrong, the password still works typed blind (then Enter); or
# Ctrl+Alt+F3, log in, `loginctl unlock-sessions`, then `bash tahoe-lockscreen.sh off`.
# tahoe-repair keeps the lock screen enabled while it is installed and switched on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-lockscreen@cachyos-tahoe
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
    # palette.js is a copy of the desktop Music widgets' module: refuse to install a stale copy
    bash "$ROOT/tools/lockscreen/check-shared.sh"
    # (no grep -q on a pipe here: with pipefail its early exit fails fc-list with SIGPIPE)
    [[ "$(fc-match -f '%{family}' 'Space Grotesk')" == *"Space Grotesk"* ]] ||
      echo "Note: the clock's font, Space Grotesk, is not installed; the clock falls back to a sans face."
    new=0; [[ -d "$DEST" ]] || new=1
    mkdir -p "$DEST"
    cp -r "$SRC/." "$DEST/"
    set_state lockscreen on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login."
    else
      echo "Updated. Code changes load at the next login; the running shell keeps the old code."
    fi ;;
  off)
    set_state lockscreen off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Tahoe lock screen off: GNOME's own lock screen from the next lock." ;;
  status)
    echo "installed: $([[ -d "$DEST" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^lockscreen=//p' "$STATE" 2>/dev/null | tail -1)"
    gnome-extensions info "$UUID" 2>/dev/null | grep State: || echo "shell: not loaded" ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
