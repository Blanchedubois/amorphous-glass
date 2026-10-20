#!/bin/bash
# gdm-theme.sh: the Tahoe login screen (GDM greeter) as a shell theme gresource. docs/GDM_PLAN.md.
#   build     make build/gdm/gnome-shell-theme.gresource (no root): the base theme's files plus
#             gdm/tahoe-gdm.css appended to every stylesheet and the lock picture as a sharp
#             background (tahoe-gdm-background.png: lossless, dithered down from the 16-bit picture)
#   install   install it (asks for the sudo password): the user's choices by default, a 24 h
#             clock, Space Grotesk and the login screen extension (GDM_CLOCK_FORMAT, GDM_FONTS,
#             GDM_EXTENSION override). Shows at the next logout or boot.
#   undo      put the previous login screen back (asks for the sudo password); it shows at the
#             next logout or boot. If the login screen is broken: from a text console
#             (Ctrl+Alt+F3), `bash scripts/gdm-theme.sh undo`, then `sudo systemctl restart gdm`.
#   commands  print the root commands of install and undo (for reading; install and undo run them
#             without the copy-paste mistakes of running both). GDM_CLOCK_FORMAT=24h also sets a 24 h
#             clock on the login screen only; GDM_FONTS=1 adds installing Space Grotesk (OFL)
#             system-wide, from ~/.local/share/fonts/SpaceGrotesk, so the greeter (user gdm) has it.
#             GDM_EXTENSION=1 adds the login screen extension (extensions/tahoe-gdm@cachyos-tahoe:
#             Liquid Glass password field and account rows, the Tahoe proportions on any monitor),
#             installed system-wide and enabled for the gdm user only.
# Base theme: the backup made at install (gnome-shell-theme.gresource.pre-gdm-tahoe, the MacTahoe
# build) if it exists, else the installed file, so a rebuild never stacks our CSS twice.
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd)
SYS=/usr/share/gnome-shell/gnome-shell-theme.gresource
BACKUP=$SYS.pre-gdm-tahoe
OUT=$R/build/gdm
DCONF_PROFILE=/etc/dconf/profile/gdm
DCONF_KEYS=/etc/dconf/db/gdm.d/90-tahoe-gdm

build() {
  local base=$SYS
  [ -f "$BACKUP" ] && base=$BACKUP
  # an installed build of ours is never a base
  if python3 -I - "$base" <<'PY'
import sys, gi
from gi.repository import Gio
r = Gio.Resource.load(sys.argv[1])
# an earlier build had a JPEG background, the current one a PNG: either means "ours"
for name in ('tahoe-gdm-background.png', 'tahoe-gdm-background.jpg'):
    try:
        r.lookup_data('/org/gnome/shell/theme/' + name, 0)
        sys.exit(0)
    except Exception:
        pass
sys.exit(1)
PY
  then echo "base $base is already a Tahoe build and there is no $BACKUP; cannot build" >&2; exit 1; fi

  local work; work=$(mktemp -d)
  trap 'rm -rf "$work"' RETURN
  python3 -I - "$base" "$work/src" "$R/gdm/tahoe-gdm.css" <<'PY'
import os, sys, gi
from gi.repository import Gio
base, src, css = sys.argv[1:]
P = '/org/gnome/shell/theme/'
r = Gio.Resource.load(base)
def walk(p):
    for c in r.enumerate_children(p, 0):
        yield from walk(p + c) if c.endswith('/') else [p + c]
files = []
extra = open(css, 'rb').read()
for f in walk(P):
    rel = f[len(P):]
    data = r.lookup_data(f, 0).get_data()
    if rel.endswith('.css') and rel != 'pad-osd.css':
        data = data + b'\n' + extra
    dst = os.path.join(src, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(data)
    files.append(rel)
files.append('tahoe-gdm-background.png')
with open(os.path.join(src, 'theme.gresource.xml'), 'w') as x:
    x.write('<?xml version="1.0" encoding="UTF-8"?>\n<gresources>\n  <gresource prefix="/org/gnome/shell/theme">\n')
    for rel in sorted(files):
        x.write(f'    <file>{rel}</file>\n')
    x.write('  </gresource>\n</gresources>\n')
PY
  # the lock screen's picture (org.gnome.desktop.screensaver picture-uri), cropped to 16:9 at 2560x1440
  local pic; pic=$(gsettings get org.gnome.desktop.screensaver picture-uri | tr -d "'")
  pic=${pic#file://}
  case $pic in
    *.jxl) djxl "$pic" "$work/pic.png" >/dev/null 2>&1; pic=$work/pic.png ;;
  esac
  # lossless and dithered: a JPEG halves the colour resolution (soft colour edges) and a plain
  # 16 to 8 bit step bands the wallpaper's smooth gradients; both read as "low res" (user, 2026-10-20)
  magick "$pic" -filter Lanczos -resize 2560x1440^ -gravity center -extent 2560x1440 -strip \
    -ordered-dither o8x8,256 -depth 8 -define png:compression-level=9 "$work/src/tahoe-gdm-background.png"
  mkdir -p "$OUT"
  glib-compile-resources --sourcedir="$work/src" --target="$OUT/gnome-shell-theme.gresource.new" "$work/src/theme.gresource.xml"
  mv "$OUT/gnome-shell-theme.gresource.new" "$OUT/gnome-shell-theme.gresource"
  echo "built $OUT/gnome-shell-theme.gresource (base $base, $(stat -c %s "$OUT/gnome-shell-theme.gresource") bytes)"
}

commands() {
  local fmt="" ext=""
  [ "${GDM_CLOCK_FORMAT:-}" = 24h ] && fmt="clock-format='24h'\\n"
  [ "${GDM_EXTENSION:-}" = 1 ] && ext="\\n[org/gnome/shell]\\nenabled-extensions=['tahoe-gdm@cachyos-tahoe']\\n"
  if [ "${GDM_FONTS:-}" = 1 ]; then cat <<EOF
# Space Grotesk for the login screen's clock (SIL Open Font License, so it may be copied)
sudo install -Dm644 $HOME/.local/share/fonts/SpaceGrotesk/SpaceGrotesk-Variable.ttf /usr/local/share/fonts/SpaceGrotesk/SpaceGrotesk-Variable.ttf
sudo install -Dm644 $HOME/.local/share/fonts/SpaceGrotesk/OFL.txt /usr/local/share/fonts/SpaceGrotesk/OFL.txt
sudo fc-cache -f /usr/local/share/fonts
EOF
  fi
  if [ "${GDM_EXTENSION:-}" = 1 ]; then cat <<EOF
# the login screen extension, system-wide (the greeter cannot read your home folder)
sudo install -d -m 755 /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe
sudo cp -r $R/extensions/tahoe-gdm@cachyos-tahoe/. /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe/
sudo chmod -R a+rX /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe
EOF
  fi
  cat <<EOF
# install (keeps the current theme as $BACKUP; skips the copy if that backup already exists)
sudo test -f $BACKUP || sudo cp -a $SYS $BACKUP
sudo install -m 644 $OUT/gnome-shell-theme.gresource $SYS
# greeter settings (a dconf database for the gdm user; the stock profile has none): the clock shows
# the time only, and no distribution logo under the prompt (as on the Mac; it sat behind the field)
printf 'user-db:user\nsystem-db:gdm\nfile-db:/usr/share/gdm/greeter-dconf-defaults\n' | sudo tee $DCONF_PROFILE
sudo mkdir -p /etc/dconf/db/gdm.d
printf "[org/gnome/desktop/interface]\nclock-show-date=false\nclock-show-weekday=false\n${fmt}\n[org/gnome/login-screen]\nlogo=''\n${ext}" | sudo tee $DCONF_KEYS
sudo dconf update
# shows at the next logout or boot; the lock screen uses the new file from its next lock

# undo (from a text console if the login screen is broken: Ctrl+Alt+F3)
sudo cp $BACKUP $SYS
sudo rm -rf /etc/dconf/db/gdm.d /etc/dconf/db/gdm $DCONF_PROFILE
sudo dconf update
sudo rm -rf /usr/local/share/fonts/SpaceGrotesk && sudo fc-cache -f    # if it was installed
sudo rm -rf /usr/share/gnome-shell/extensions/tahoe-gdm@cachyos-tahoe   # if it was installed
sudo systemctl restart gdm    # only from the text console: it ends any graphical session
EOF
}

# run the install or the undo half of the commands (the same text `commands` prints)
run_part() {
  export GDM_CLOCK_FORMAT=${GDM_CLOCK_FORMAT:-24h} GDM_FONTS=${GDM_FONTS:-1} GDM_EXTENSION=${GDM_EXTENSION:-1}
  local text part
  text=$(commands)
  case $1 in
    install) part=${text%%"# undo ("*} ;;
    # a restart of gdm ends the graphical session: never from here (see the usage above)
    undo) part=$(printf '%s\n' "${text#*"# undo ("}" | tail -n +2 | grep -v 'systemctl restart gdm') ;;
  esac
  local script; script=$(mktemp)
  printf 'set -euo pipefail\n%s\n' "$part" > "$script"
  bash "$script"
  rm -f "$script"
}

case ${1:-} in
  build) build ;;
  commands) commands ;;
  install)
    build   # always from the current checkout: never an older build left in build/gdm
    run_part install
    echo "Installed. The new login screen shows at the next logout or boot." ;;
  undo)
    run_part undo
    echo "Undone. The previous login screen shows at the next logout or boot." ;;
  *) echo "usage: $0 build|install|undo|commands" >&2; exit 2 ;;
esac
