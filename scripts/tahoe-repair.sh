#!/usr/bin/env bash
# tahoe-repair: keep the Liquid Glass desktop as designed through updates (docs/REPAIR.md).
#
#   tahoe-repair.sh            repair: fix only what drifted, logged and backed up (the login autostart)
#   tahoe-repair.sh check      read-only report; exit 0 ok, 1 drift, 2 needs you (logout, sudo, held), 3 failed
#   tahoe-repair.sh status     versions, switches and hold mode
#   tahoe-repair.sh units on   install and enable the optional user units (run after package changes)
#   tahoe-repair.sh units off  disable and remove them
#   tahoe-repair.sh --gdm      the root commands for the Tahoe login screen
# Options for check and repair: --only ID[,ID] (manifest ids, prefix match), --verbose, --wait N.
#
# The expected state is config/repair-manifest.json (scripts/repair_manifest.py, from tokens/); the
# switches are ~/.config/tahoe-glass/state (a feature switched off stays off; repair-skip=ID,ID leaves
# items alone; repair=off stops it). Never runs sudo. The previous script is scripts/tahoe-repair-legacy.sh.
set -uo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
case "${1:-repair}" in
  --gdm)
    cat <<EOT
The Tahoe login screen is a shell theme gresource plus a greeter extension, installed with sudo:
  bash $ROOT/scripts/gdm-theme.sh install     # the user's choices; shows at the next logout or boot
  bash $ROOT/scripts/gdm-theme.sh commands    # print the root commands to read them first
  bash $ROOT/scripts/gdm-theme.sh undo        # put the previous login screen back
Every gnome-shell update replaces the gresource; 'tahoe-repair.sh check' reports it (item A6).
EOT
    exit 0 ;;
  units)
    U="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    case "${2:-}" in
      on)
        mkdir -p "$U"
        for f in tahoe-repair.service tahoe-repair.path; do sed "s|@ROOT@|$ROOT|g" "$ROOT/config/systemd/$f" > "$U/$f"; done
        systemctl --user daemon-reload && systemctl --user enable --now tahoe-repair.path
        echo "tahoe-repair.path on: repair runs when the pacman hook stamp or GNOME's pending extension updates change."
        echo "The pacman hook itself needs root: sudo install -m644 $ROOT/config/pacman/95-tahoe-repair.hook /etc/pacman.d/hooks/" ;;
      off)
        systemctl --user disable --now tahoe-repair.path 2>/dev/null
        rm -f "$U/tahoe-repair.service" "$U/tahoe-repair.path"; systemctl --user daemon-reload
        echo "units off" ;;
      *) echo "usage: units on|off"; exit 1 ;;
    esac
    exit 0 ;;
  repair|check|status|--*) ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
# the login autostart (OnlyShowIn=GNOME) and the units run inside GNOME; elsewhere there is nothing to keep
case "${1:-repair}" in
  check|status) ;;
  *) [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] || { echo "[tahoe-repair] not a GNOME session, nothing to do"; exit 0; } ;;
esac
# the autostart passes no argument: repair, after waiting for the shell's extension system
[[ $# -eq 0 ]] && set -- repair --wait 60
exec python3 "$ROOT/scripts/tahoe_repair.py" "$@"
