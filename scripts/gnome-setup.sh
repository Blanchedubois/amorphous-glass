#!/usr/bin/env bash
# GNOME setup for the CachyOS Tahoe theme. Per-user, no root. Idempotent.
#
# Prerequisites (root, once): sudo pacman -S --needed gnome gnome-tweaks gnome-shell-extensions
# Then log out and choose the GNOME session. This script can run from any
# session; GNOME reads the settings at login. Extensions are fetched for the
# installed gnome-shell major version.
set -euo pipefail
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHELL_VER="$(gnome-shell --version | grep -oE '[0-9]+' | head -1)"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
SRC="$HOME/.local/src/MacTahoe-gtk-theme"
EXTS=(dash-to-dock@micxgx.gmail.com blur-my-shell@aunetx appindicatorsupport@rgcjonas.gmail.com rounded-window-corners@fxgn nowplaying@epogonii.github.io Vitals@CoreCoding.com)

# 1. MacTahoe GTK + shell theme, exactly as the README recommends for GNOME:
#    the blur variant (-b) since Blur my Shell is used, all colour and
#    opacity variants, the libadwaita link, the Dash to Dock fix, and the
#    bundled day/night wallpaper. The installer needs a pseudo-terminal.
say "MacTahoe GTK and shell theme (blur variant)"
[[ -d "$SRC" ]] || git clone -q --depth 1 https://github.com/vinceliuice/MacTahoe-gtk-theme "$SRC"
rm -rf /tmp/MacTahoe.lock
# ONE run installs the themes and the libadwaita link. Running "-l" as a
# second pass cleans every MacTahoe theme first and writes only the gtk-4.0
# config, which is how the themes kept vanishing.
( cd "$SRC" && TERM=xterm-256color script -qfec "./install.sh -b -l" /dev/null >/dev/null 2>&1 ) || true
# Not run: tweaks.sh -d renames Dash to Dock's stylesheet.css, which breaks
# Dash to Dock 110 on GNOME 51 (it fails to load without it). With "use
# built-in theme" off the shell theme styles the dock anyway.
# The wallpaper installer writes its properties file where a directory should
# be when run as a user; create the directory first.
PROPS="$HOME/.local/share/gnome-background-properties"
[[ -f "$PROPS" ]] && rm -f "$PROPS"; mkdir -p "$PROPS"
( cd "$SRC/wallpaper" && ./install-gnome-backgrounds.sh >/dev/null 2>&1 ) || true
BG="$HOME/.local/share/backgrounds/MacTahoe"
if [[ -f "$BG/MacTahoe-night.jpeg" ]]; then
  gsettings set org.gnome.desktop.background picture-uri "file://$BG/MacTahoe-day.jpeg"
  gsettings set org.gnome.desktop.background picture-uri-dark "file://$BG/MacTahoe-night.jpeg"
  gsettings set org.gnome.desktop.background picture-options 'zoom'
  gsettings set org.gnome.desktop.screensaver picture-uri "file://$BG/MacTahoe-night.jpeg"
fi
# Firefox theme from the same repo, only when Firefox is closed.
# (opt-in: it changes the Firefox profile) TAHOE_FIREFOX=1
[[ "${TAHOE_FIREFOX:-}" == 1 ]] && { pgrep -x firefox >/dev/null || ( cd "$SRC" && ./tweaks.sh -f >/dev/null 2>&1 ) || true; }

# 2. Extensions from extensions.gnome.org for this shell version.
say "extensions for GNOME $SHELL_VER"
mkdir -p "$EXT_DIR"
tmp="$(mktemp -d)"
for e in "${EXTS[@]}"; do
  tag="$(curl -s "https://extensions.gnome.org/extension-info/?uuid=$e&shell_version=$SHELL_VER" \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["version_tag"])' 2>/dev/null || true)"
  if [[ -z "$tag" ]]; then echo "    no build of $e for GNOME $SHELL_VER yet; skipped"; continue; fi
  curl -sL "https://extensions.gnome.org/download-extension/$e.shell-extension.zip?version_tag=$tag" -o "$tmp/$e.zip"
  rm -rf "${EXT_DIR:?}/${e:?}"; mkdir -p "$EXT_DIR/$e"
  python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/$e.zip" "$EXT_DIR/$e"
  [[ -d "$EXT_DIR/$e/schemas" ]] && glib-compile-schemas "$EXT_DIR/$e/schemas"
done
rm -rf "$tmp"
# A running shell only scans for extensions at startup. Ask it to load them
# in place through its own installer so no logout is needed.
if pgrep -x gnome-shell >/dev/null; then
  for e in "${EXTS[@]}"; do
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.InstallRemoteExtension "$e" >/dev/null 2>&1 || true
  done
fi

# 3. Core look.
say "interface"
gsettings set org.gnome.desktop.interface gtk-theme 'MacTahoe-Dark-solid'   # GTK3: filled headers; GTK4 uses the blur variant via gtk-4.0 config
gsettings set org.gnome.desktop.interface icon-theme 'MacTahoe-dark'
gsettings set org.gnome.desktop.interface cursor-theme 'MacTahoe-dark'
gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'
gsettings set org.gnome.desktop.wm.preferences button-layout 'close,minimize,maximize:'
gsettings set org.gnome.mutter draggable-border-width 28   # corners stay grabbable past the 24 px clip
# system font: SF Pro, only from the user's own Apple download (see scripts/sf-fonts.sh)
if [[ -f "$HOME/Downloads/SF-Pro.dmg" || -n "$(fc-list 'SF Pro Text' family)" ]]; then
  bash "$ROOT/scripts/sf-fonts.sh" "$([[ -n "$(fc-list 'SF Pro Text' family)" ]] && echo apply)" || echo "  SF Pro not set up"
fi
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions \
  "['user-theme@gnome-shell-extensions.gcampax.github.com','dash-to-dock@micxgx.gmail.com','blur-my-shell@aunetx','appindicatorsupport@rgcjonas.gmail.com','rounded-window-corners@fxgn','nowplaying@epogonii.github.io','Vitals@CoreCoding.com']"
gsettings set org.gnome.shell.extensions.user-theme name 'MacTahoe-Dark'
# the author's dock apps, only when asked for (TAHOE_FAVORITES=1); everyone else keeps their own
[[ "${TAHOE_FAVORITES:-}" == 1 ]] && gsettings set org.gnome.shell favorite-apps \
  "['org.gnome.Nautilus.desktop','firefox.desktop','discord.desktop','steam.desktop','com.anthropic.Claude.desktop','spotify.desktop','org.gnome.Console.desktop','org.gnome.Calculator.desktop','org.gnome.TextEditor.desktop','org.gnome.Settings.desktop']"

# 4. Dock: bottom, intellihide, 48 px, themed by the shell theme, glass.
say "dock"
dd() { gsettings --schemadir "$EXT_DIR/dash-to-dock@micxgx.gmail.com/schemas" set org.gnome.shell.extensions.dash-to-dock "$1" "$2"; }
if [[ -d "$EXT_DIR/dash-to-dock@micxgx.gmail.com/schemas" ]]; then
  dd dock-position 'BOTTOM'; dd dock-fixed false; dd intellihide true
  dd intellihide-mode 'FOCUS_APPLICATION_WINDOWS'; dd autohide true
  dd dash-max-icon-size 48; dd icon-size-fixed true
  dd show-trash true; dd show-mounts false; dd show-show-apps-button true; dd show-apps-at-top false
  dd apply-custom-theme false; dd custom-theme-shrink true
  # Theme's own dock styling: default transparency, no custom colour, let
  # the shell theme and Blur my Shell draw the backing.
  dd transparency-mode 'DEFAULT'; dd custom-background-color false
  dd running-indicator-style 'DOTS'; dd click-action 'minimize-or-previews'; dd scroll-action 'cycle-windows'
  dd multi-monitor false; dd extend-height false
fi

# 5. Blur my Shell, key for key from the author's screenshot in the README
#    (blur-my-shell.png): panel off, overview on with unstyled components,
#    app folders on, dock on with the rounded pipeline, applications on for all.
say "blur (author's settings)"
bs() { gsettings --schemadir "$EXT_DIR/blur-my-shell@aunetx/schemas" set "org.gnome.shell.extensions.blur-my-shell$1" "$2" "$3"; }
if [[ -d "$EXT_DIR/blur-my-shell@aunetx/schemas" ]]; then
  bs .panel blur false; bs .panel override-background true; bs .panel unblur-in-overview true
  bs .overview blur true; bs .overview style-components 0; bs .overview pipeline 'pipeline_default'
  bs .appfolder blur true; bs .appfolder sigma 30; bs .appfolder brightness 1.0; bs .appfolder style-dialogs 1
  bs .dash-to-dock blur true; bs .dash-to-dock static-blur true; bs .dash-to-dock pipeline 'pipeline_default_rounded'
  bs .dash-to-dock override-background false; bs .dash-to-dock unblur-in-overview true
  # Applications blur is OFF: on this machine it paints an opaque square
  # behind the quick-settings popup instead of blurring it. The panel, dock,
  # overview and app-folder modules give the look without it.
  # Applications blur on a whitelist of system apps, static pipeline.
  bs .applications enable-all false; bs .applications static-blur true; bs .applications customize true; bs .applications pipeline 'pipeline_default_rounded'; bs .applications corner-radius 16; bs .applications sigma 30; bs .applications brightness 0.6; bs .applications opacity 215
  bs .applications whitelist "['org.gnome.Nautilus','org.gnome.Settings','gnome-control-center','org.gnome.Console','kgx','org.gnome.TextEditor','org.gnome.Calculator','org.gnome.Loupe','org.gnome.Papers','org.gnome.Characters','org.gnome.clocks','org.gnome.Calendar','org.gnome.Weather','org.gnome.Music','org.gnome.Software','org.gnome.DiskUtility','org.gnome.baobab','org.gnome.SystemMonitor','org.gnome.tweaks','org.gnome.Extensions','org.gnome.Logs','org.gnome.font-viewer','org.kde.dolphin','org.kde.kate','org.kde.konsole']"
  bs .applications blur true
  # Popups (quick settings, menus, notifications) are never blurred: they
  # use the plain tint in the shell overrides.
  bs .popup blur false
fi
# Icons: the Tahoe-Material theme, SF Symbol watermarks on glass squircles.
say "icons"
# the Tahoe-Material icons live in cachyos-tahoe-theme: TAHOE_ICONS is its icons folder (install.sh
# fetches it); without it the MacTahoe icons stay
ICONS="${TAHOE_ICONS:-$ROOT/icons}"
if [[ -f "$ICONS/Tahoe-Material/index.theme" ]]; then
  mkdir -p "$HOME/.local/share/icons"; ln -sfn "$ICONS/Tahoe-Material" "$HOME/.local/share/icons/Tahoe-Material"
  gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/Tahoe-Material" 2>/dev/null || true
fi
# Now Playing Card as macOS's Now Playing: an animated icon in the top bar
# and no track text, a full card with large artwork, progress line and
# transport only. The look itself is in gnome-shell-overrides.css.
say "now playing"
np() { gsettings --schemadir "$EXT_DIR/nowplaying@epogonii.github.io/schemas" set org.gnome.shell.extensions.nowplaying "$1" "$2"; }
if [[ -d "$EXT_DIR/nowplaying@epogonii.github.io/schemas" ]]; then
  np location 'panel'; np panel-box 'right'; np panel-text 'none'; np panel-icon true; np panel-controls false
  np indicator-visibility 'active'; np hide-builtin-media true
  np card-layout 'full'; np cover-size 'large'; np show-artwork true; np show-progress true
  np show-volume false; np show-loop-shuffle false; np show-spectrum false
  np equalizer-style 'rounded'; np equalizer-accent false; np animate-icon true
fi
# Vitals: a system monitor dropdown in the top bar, like iStat Menus. The
# bar shows the hottest sensor, CPU, GPU (nvidia-smi) and memory; voltage
# and the public IP lookup (an outside service) are off.
vt() { gsettings --schemadir "$EXT_DIR/Vitals@CoreCoding.com/schemas" set org.gnome.shell.extensions.vitals "$1" "$2"; }
if [[ -d "$EXT_DIR/Vitals@CoreCoding.com/schemas" ]]; then
  vt hot-sensors "['__temperature_max__', '_processor_usage_', '_gpu#1_utilization_', '_memory_usage_']"
  vt show-gpu true; vt show-voltage false; vt show-battery false; vt include-public-ip false; vt position-in-panel 2
fi
# Desktop-entry overrides: launchers whose icon name or window class needs fixing (Steam games, HP tools).
if compgen -G "$ROOT/overrides/*.desktop" >/dev/null; then mkdir -p "$HOME/.local/share/applications"; cp "$ROOT"/overrides/*.desktop "$HOME/.local/share/applications/"; update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true; fi
if [[ -f "$ICONS/Tahoe-Material/index.theme" ]]; then
  gsettings set org.gnome.desktop.interface icon-theme 'Tahoe-Material'
  if [[ -d "$ICONS/Tahoe-Material-KDE" ]]; then
    ln -sfn "$ICONS/Tahoe-Material-KDE" "$HOME/.local/share/icons/Tahoe-Material-KDE"
    command -v kwriteconfig6 >/dev/null && kwriteconfig6 --file kdeglobals --group Icons --key Theme Tahoe-Material-KDE
  fi
fi
# The shell CSS overrides, rendered with the Liquid Glass tokens into both shell themes
# (replaces the block, so a rerun picks up new rules).
bash "$ROOT/scripts/glass-bar.sh" overrides
# GTK3: round the bottom corners too (theme ships 24px 24px 0 0).
for f in "$HOME"/.themes/MacTahoe-*/gtk-3.0/gtk.css "$HOME"/.themes/MacTahoe-*/gtk-3.0/gtk-dark.css; do [[ -f "$f" ]] && sed -i 's/border-radius: 24px 24px 0 0/border-radius: 24px/g' "$f"; done
# Modal dialogs out of Blur my Shell's popup surfaces (whole-screen blur otherwise).
BSF="$EXT_DIR/blur-my-shell@aunetx/components/popup/blur_surface.js"
[[ -f "$BSF" ]] && python3 - "$BSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    'modal-dialog', 'run-dialog',\n","").replace("    'datemenu-popover', 'quick-settings', 'modal-dialog',","    'datemenu-popover', 'quick-settings',")
open(p,"w").write(s)
t=p.replace("blur_surface.js","targets.js"); u=open(t).read()
u=u.replace("        style_classes: ['modal-dialog', 'run-dialog'],","        style_classes: [],  /* tahoe: modal dialogs are not blurred */")
open(t,"w").write(u)
PY
# Rounded Window Corners: GNOME 51 port of its shader effects, settings.
RWC="$EXT_DIR/rounded-window-corners@fxgn"
[[ -d "$RWC/effect" ]] && { cp "$ROOT"/config/rwc-gnome51/*.js "$RWC/effect/"; python3 -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m['shell-version']=['51']; json.dump(m,open(p,'w'),indent=4)" "$RWC/metadata.json"; }
gsettings set org.gnome.shell disable-extension-version-validation true
# Reload the shell theme so a reinstalled stylesheet is picked up. The theme
# build deletes and recreates ~/.themes/MacTahoe-Dark; a running shell falls
# back to Adwaita (square, opaque popups) until the name is set again.
gsettings set org.gnome.shell.extensions.user-theme name ''; gsettings set org.gnome.shell.extensions.user-theme name 'MacTahoe-Dark'

say "done. Log out and choose GNOME; extensions load on that login."

# 7. Repair command and login hook.
say "repair hook"
mkdir -p "$HOME/.local/bin" "$HOME/.config/autostart"
ln -sfn "$ROOT/scripts/tahoe-repair.sh" "$HOME/.local/bin/tahoe-repair"
sed "s|@ROOT@|$ROOT|" "$ROOT/config/tahoe-repair.desktop.in" > "$HOME/.config/autostart/tahoe-repair.desktop"
