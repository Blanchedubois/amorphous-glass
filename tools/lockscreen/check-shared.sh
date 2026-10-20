#!/bin/bash
# check-shared.sh: the lock screen extension carries exact copies of some tahoe-widgets files
# (tools/lockscreen/shared.list) in its widgets/ folder; this fails when any has drifted apart.
# Fix with tools/lockscreen/sync-shared.sh.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
bad=0
while read -r src dest; do
  case "$src" in ''|'#'*) continue ;; esac
  if ! cmp -s "$R/extensions/tahoe-widgets@cachyos-tahoe/$src" "$R/extensions/tahoe-lockscreen@cachyos-tahoe/widgets/$dest"; then
    echo "widgets/$dest differs from tahoe-widgets/$src" >&2
    bad=1
  fi
done < "$(dirname "$0")/shared.list"
[ "$bad" = 0 ] && echo "shared files: in sync" || { echo "run tools/lockscreen/sync-shared.sh" >&2; exit 1; }
