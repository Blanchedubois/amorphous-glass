#!/usr/bin/env bash
# sf-fonts.sh: Apple's San Francisco as the system font (macOS Tahoe's UI face).
#
# The fonts are NOT in this repo and are never fetched from mirrors: Apple licenses them
# only through developer.apple.com/fonts. Download SF-Pro.dmg there yourself (read the
# licence), leave it in ~/Downloads, then run this. SF-Mono.dmg is installed too if present.
#
#   bash scripts/sf-fonts.sh [path/to/SF-Pro.dmg]   install the static OTFs, set the fonts
#   bash scripts/sf-fonts.sh apply                  only set the fonts (already installed)
#
# Tahoe's sizes on GNOME (macOS points at 72 dpi = px; GNOME pt at 96 dpi = 1.33 px):
#   menus, buttons, sidebars, Control Center: SF Pro Text Regular 13 px -> 'SF Pro Text 10'
#   window titles: SF Pro Text Bold 13 px                           -> 'SF Pro Text Bold 10'
#   documents: one step up for reading                              -> 'SF Pro Text 11'
#   top bar: bold, Open Bar takes it from the interface font (glass-bar.sh, tahoe-repair step 15)
# The static Text/Display cuts are used rather than the variable SF-Pro.ttf: GNOME does not
# switch the optical size by itself, and Text is the cut Tahoe draws at these sizes.
# Log out and back in afterwards: the running shell does not see newly installed fonts.
set -euo pipefail

DEST="$HOME/.local/share/fonts/SF-Pro"

extract() {   # extract DMG FONTDIR: dmg -> pkg -> Payload (cpio) -> Library/Fonts/*.otf
  local tmp; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/dmg" "$tmp/pkg" "$tmp/payload"
  7z x -y -o"$tmp/dmg" "$1" >/dev/null
  7z x -y -o"$tmp/pkg" "$(find "$tmp/dmg" -name '*.pkg' | head -1)" >/dev/null
  (cd "$tmp/payload" && 7z x -so "$(find "$tmp/pkg" -name Payload | head -1)" 2>/dev/null | cpio -id --quiet)
  mkdir -p "$2"
  find "$tmp/payload" -name '*.otf' ! -name 'SF-Pro.*' -exec cp {} "$2/" \;
}

apply() {
  [[ -n "$(fc-list 'SF Pro Text' family)" ]] || { echo "SF Pro Text is not installed"; exit 1; }
  gsettings set org.gnome.desktop.interface font-name 'SF Pro Text 10'
  gsettings set org.gnome.desktop.interface document-font-name 'SF Pro Text 11'
  gsettings set org.gnome.desktop.wm.preferences titlebar-font 'SF Pro Text Bold 10'
  # macOS draws text unhinted and greyscale; slight hinting keeps the shapes and stays crisp at 1x
  gsettings set org.gnome.desktop.interface font-antialiasing 'grayscale'
  gsettings set org.gnome.desktop.interface font-hinting 'slight'
  echo "fonts set: SF Pro Text 10 (documents 11, titles bold). Log out and back in for the shell."
}

case "${1:-}" in
  apply) apply; exit ;;
esac

command -v 7z >/dev/null || { echo "needs 7z: sudo pacman -S 7zip"; exit 1; }
dmg="${1:-$HOME/Downloads/SF-Pro.dmg}"
[[ -f "$dmg" ]] || { echo "no $dmg: download SF-Pro.dmg from https://developer.apple.com/fonts/"; exit 1; }
extract "$dmg" "$DEST"
[[ -f "$(dirname "$dmg")/SF-Mono.dmg" ]] && extract "$(dirname "$dmg")/SF-Mono.dmg" "$HOME/.local/share/fonts/SF-Mono"
fc-cache -f "$HOME/.local/share/fonts" >/dev/null
echo "installed $(ls "$DEST" | wc -l) SF Pro fonts in $DEST"
apply
