#!/bin/bash
# sync-shared.sh: copy the shared tahoe-widgets files (tools/lockscreen/shared.list) into the lock
# screen extension's widgets/ folder. Run after changing any of them; check-shared.sh verifies.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$R/extensions/tahoe-lockscreen@cachyos-tahoe/widgets"
grep -v '^#' "$(dirname "$0")/shared.list" | while read -r src dest; do
  [ -z "$src" ] && continue
  from="$R/extensions/tahoe-widgets@cachyos-tahoe/$src"; to="$R/extensions/tahoe-lockscreen@cachyos-tahoe/widgets/$dest"
  if [ -d "$from" ]; then rm -rf "$to"; cp -r "$from" "$to"; else cp "$from" "$to"; fi
done
echo "synced"
