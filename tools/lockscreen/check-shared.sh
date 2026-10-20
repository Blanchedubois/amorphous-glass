#!/bin/bash
# check-shared.sh: the lock screen extension carries an exact copy of tahoe-widgets' palette.js
# (an installed extension must be self-contained); this fails when the two have drifted apart.
set -eu
R=$(cd "$(dirname "$0")/../.." && pwd)
if cmp -s "$R/extensions/tahoe-widgets@cachyos-tahoe/palette.js" "$R/extensions/tahoe-lockscreen@cachyos-tahoe/palette.js"; then
  echo "palette.js: in sync"
else
  echo "palette.js differs: cp extensions/tahoe-widgets@cachyos-tahoe/palette.js extensions/tahoe-lockscreen@cachyos-tahoe/" >&2
  exit 1
fi
