#!/bin/bash
# sync-shared.sh: copy the shared files (tools/nowplaying/shared.list) into tahoe-nowplaying's
# shared/ folder. Run after changing any of them; check-shared.sh verifies.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
dest_dir="$R/extensions/tahoe-nowplaying@cachyos-tahoe/shared"
mkdir -p "$dest_dir"
while read -r src dest; do
  case "$src" in ''|'#'*) continue ;; esac
  from="$R/extensions/$src"; to="$dest_dir/$dest"
  if [ -d "$from" ]; then rm -rf "$to"; cp -r "$from" "$to"; else cp "$from" "$to"; fi
done < "$(dirname "$0")/shared.list"
echo "synced"
