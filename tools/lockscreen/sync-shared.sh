#!/bin/bash
# sync-shared.sh: copy the shared tahoe-widgets files (tools/lockscreen/shared.list) into the lock
# screen extension's widgets/ folder. Run after changing any of them; check-shared.sh verifies.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$R/extensions/tahoe-lockscreen@cachyos-tahoe/widgets"
grep -v '^#' "$(dirname "$0")/shared.list" | while read -r src dest; do
  [ -n "$src" ] && cp "$R/extensions/tahoe-widgets@cachyos-tahoe/$src" "$R/extensions/tahoe-lockscreen@cachyos-tahoe/widgets/$dest"
done
echo "synced"
