#!/bin/bash
# check-shared.sh: the login screen extension carries exact copies of some tahoe-widgets files
# (tools/gdm/shared.list) in its widgets/ folder; this fails when any has drifted apart.
# Fix with tools/gdm/sync-shared.sh.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
bad=0
while read -r src dest; do
  case "$src" in ''|'#'*) continue ;; esac
  from="$R/extensions/tahoe-widgets@cachyos-tahoe/$src"; to="$R/extensions/tahoe-gdm@cachyos-tahoe/widgets/$dest"
  if [ -d "$from" ]; then same() { diff -rq "$from" "$to" >/dev/null 2>&1; }; else same() { cmp -s "$from" "$to"; }; fi
  if ! same; then
    echo "widgets/$dest differs from tahoe-widgets/$src" >&2
    bad=1
  fi
done < "$(dirname "$0")/shared.list"
[ "$bad" = 0 ] && echo "shared files: in sync" || { echo "run tools/gdm/sync-shared.sh" >&2; exit 1; }
