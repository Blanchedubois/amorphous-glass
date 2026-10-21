#!/usr/bin/env bash
# sandbox.sh seed DIR             a throwaway home in DIR: copies of the user's themes, GTK CSS, state file,
#                                 extensions, Blur My Shell source and dconf settings (read from the real
#                                 ones, never written); fonts and icons are linked read-only
# sandbox.sh run DIR CMD [ARG..]  run CMD in that home on its own D-Bus session (own dconf database, no
#                                 shell, no notifications): nothing reaches the live desktop
# Used by tools/repair-test/drift-test.sh (docs/REPAIR.md, Phase 4). No lock screen, no GDM, no PAM.
set -euo pipefail
cmd=${1:-}; dir=${2:-}
[[ -n "$dir" ]] || { sed -n '2,7p' "$0"; exit 1; }
REAL=$HOME
H=$dir/home

seed() {
  [[ ! -e "$dir" ]] || { echo "$dir exists"; exit 1; }
  mkdir -p "$H/.themes" "$H/.config" "$H/.local/share/gnome-shell" "$H/.local/src" "$H/.local/share/icons" "$H/.local/bin" "$dir/run"
  chmod 700 "$dir/run"
  for t in "$REAL"/.themes/MacTahoe-{Dark,Light}{,-solid}; do cp -a "$t" "$H/.themes/"; done
  cp -a "$REAL/.config/gtk-3.0" "$REAL/.config/gtk-4.0" "$REAL/.config/tahoe-glass" "$H/.config/"
  # the GTK4 links point into the real home: point them at the copies
  for l in gtk.css gtk-dark.css; do
    t=$(readlink "$H/.config/gtk-4.0/$l" || true); [[ -n "$t" ]] && ln -sfn "${t/#$REAL/$H}" "$H/.config/gtk-4.0/$l"
  done
  rm -f "$H/.config/tahoe-glass/calendar-url"   # never copy a private feed link
  [[ -d "$REAL/.config/autostart" ]] && cp -a "$REAL/.config/autostart" "$H/.config/"
  cp -a "$REAL/.local/share/gnome-shell/extensions" "$H/.local/share/gnome-shell/"
  mkdir -p "$H/.local/share/gnome-shell/extension-updates"
  for s in blur-my-shell MacTahoe-gtk-theme; do [[ -d "$REAL/.local/src/$s" ]] && cp -a "$REAL/.local/src/$s" "$H/.local/src/"; done
  ln -s "$REAL/.local/share/fonts" "$H/.local/share/fonts"
  [[ -d "$REAL/.local/share/applications" ]] && cp -a "$REAL/.local/share/applications" "$H/.local/share/"
  mkdir -p "$H/Projects"; [[ -d "$REAL/Projects/cachyos-tahoe-theme" ]] && ln -s "$REAL/Projects/cachyos-tahoe-theme" "$H/Projects/"
  for i in "$REAL"/.local/share/icons/*; do ln -s "$(readlink -f "$i")" "$H/.local/share/icons/$(basename "$i")"; done
  dconf dump /org/gnome/ > "$dir/org-gnome.dconf"
  run_in dconf load /org/gnome/ < "$dir/org-gnome.dconf"
  echo "sandbox seeded: $H"
}

run_in() {
  env -i PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM="${TERM:-dumb}" USER="$USER" \
    HOME="$H" XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/.local/share" XDG_CACHE_HOME="$H/.cache" \
    XDG_STATE_HOME="$H/.local/state" XDG_RUNTIME_DIR="$dir/run" XDG_CURRENT_DESKTOP=GNOME \
    GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 TAHOE_REPAIR_NO_SHELL=1 TAHOE_REPAIR_NOTIFY=print TAHOE_REPAIR_PKG_STAMP="$dir/packages-changed" \
    TAHOE_REPAIR_ALLOW_WORKTREE=1 $(env | grep -E '^TAHOE_REPAIR_[A-Z_]+=' | tr '\n' ' ') \
    REAL_BUS="${DBUS_SESSION_BUS_ADDRESS:-none}" \
    dbus-run-session -- bash -c '
      [[ "$DBUS_SESSION_BUS_ADDRESS" != "$REAL_BUS" && "$HOME" != '"'$REAL'"' ]] || { echo "sandbox not isolated" >&2; exit 99; }
      unset REAL_BUS; exec "$@"' bash "$@"
}

case "$cmd" in
  seed) seed ;;
  run) shift 2; run_in "$@" ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
