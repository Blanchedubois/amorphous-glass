#!/usr/bin/env bash
# smoke.sh DIR: a few drifts in a sandbox (sandbox.sh seed DIR first), then check, repair, check.
set -uo pipefail
dir=$1
T=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$T/../.." && pwd)
H=$dir/home
sbx() { bash "$T/sandbox.sh" run "$dir" "$@" 2>&1 | grep -vE 'dbus-daemon\[|connection to the bus'; }
BS=$H/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/schemas

sbx gsettings set org.gnome.desktop.wm.preferences button-layout 'appmenu:close'
sbx gsettings set org.gnome.shell enabled-extensions "['user-theme@gnome-shell-extensions.gcampax.github.com', 'some-user-ext@example']"
sbx gsettings --schemadir "$BS" set org.gnome.shell.extensions.blur-my-shell.popup pipeline pipeline_default
sed -i 's/border-radius: 24px;/border-radius: 24px 24px 0 0;/' "$H/.themes/MacTahoe-Dark/gtk-3.0/gtk.css"
python3 - "$H/.config/gtk-3.0/gtk.css" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
open(p, 'w').write(re.sub(r'/\* tahoe-glass-gtk3.*?end tahoe-glass-gtk3 \*/\n?', '', s, flags=re.S))
PY
echo "== check after drift"; sbx python3 "$R/scripts/tahoe_repair.py" check | grep -v '^info'
echo "== repair"; sbx python3 "$R/scripts/tahoe_repair.py" repair
echo "== check after repair"; sbx python3 "$R/scripts/tahoe_repair.py" check | grep -v '^info'
echo "== enabled-extensions"; sbx gsettings get org.gnome.shell enabled-extensions
