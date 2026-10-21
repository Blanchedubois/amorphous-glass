#!/bin/bash
# check-shared.sh: tahoe-nowplaying carries exact copies of some files of the other extensions
# (tools/nowplaying/shared.list) in its shared/ folder; this fails when any has drifted apart.
# Fix with tools/nowplaying/sync-shared.sh.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
bad=0
while read -r src dest; do
  case "$src" in ''|'#'*) continue ;; esac
  from="$R/extensions/$src"; to="$R/extensions/tahoe-nowplaying@cachyos-tahoe/shared/$dest"
  if [ -d "$from" ]; then same() { diff -rq "$from" "$to" >/dev/null 2>&1; }; else same() { cmp -s "$from" "$to"; }; fi
  if ! same; then
    echo "shared/$dest differs from $src" >&2
    bad=1
  fi
done < "$(dirname "$0")/shared.list"
[ "$bad" = 0 ] && echo "shared files: in sync" || { echo "run tools/nowplaying/sync-shared.sh" >&2; exit 1; }
