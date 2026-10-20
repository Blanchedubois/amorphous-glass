#!/usr/bin/env bash
# tahoe-repair: put the GNOME Tahoe look back whenever it breaks.
#
# Every failure seen so far is deterministic, so this checks each one and
# applies the known fix. Safe to run any time; it changes nothing that is
# already right. Also run once per login from the autostart entry that
# gnome-setup.sh installs, so an upgrade or a crash never leaves the shell
# on Adwaita with no dock.
#
# Checks, in order:
#   1. theme files present (else rebuild from source, one installer run)
#   2. extension folders present (else fetch builds for the running shell)
#   3. extensions loaded in the running shell (else ask it to load them)
#   4. extensions enabled
#   5. shell theme is MacTahoe-Dark and actually loaded (else re-apply)
#   6. Blur my Shell module config: applications on a system-app whitelist, popups never blurred
#   7. icon theme is Tahoe-Material and its files are present
#   8. extension builds match the running GNOME version (else re-fetch)
#   9. interface drift: GTK theme, cursor, button layout, resize border (never the wallpaper)
#  --gdm prints the root commands for the MacTahoe login screen
#  10. dock drift: Dash to Dock back on the theme's own styling
#  11. dock stylesheet present (the theme's -d tweak deletes it)
#  5c. Blur my Shell patched so modal dialogs do not blur the whole screen
#  5b2. no popup blur: undo the earlier per-piece and app-popover blur patches and GTK4 popover translucency
#  5d. GTK3 windows rounded on all four corners
#  5e. Rounded Window Corners ported to GNOME 51 and configured (24 px, non-libadwaita windows)
#  12. icon theme contents: regenerate from the repo if the generated set is
#      missing or stale (symbolic places for Files, apps, KDE companion)
#  12b. symbolic icons regenerated when their tokens change (stamp)
#  13. Now Playing Card settings drift
#  14. Vitals settings drift
#  15. glass bar mode: Open Bar keeps to the bar shape (no menu/notification/GTK styling)
#
# Glass mode (scripts/glass-bar.sh): a patched Blur My Shell v76, Open Bar's
# floating pill, a Liquid Glass top bar and glass menus. glass-bar.sh records
# its choices in ~/.config/tahoe-glass/state (enabled=1, bar=glass|plain,
# menus=on|off, dock=on|off, apps=on|off) and 'glass-bar.sh undo' deletes it; this enforces exactly that.
# The Blur My Shell build is labelled with extensions.gnome.org's version so
# GNOME's updater leaves it alone, so the version number is no switch.
set -uo pipefail
log() { printf '[tahoe-repair] %s\n' "$*"; }

[[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] || { log "not a GNOME session, nothing to do"; exit 0; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$HOME/.local/src/MacTahoe-gtk-theme"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
EXTS=(dash-to-dock@micxgx.gmail.com blur-my-shell@aunetx appindicatorsupport@rgcjonas.gmail.com rounded-window-corners@fxgn nowplaying@epogonii.github.io Vitals@CoreCoding.com)
GLASS_STATE="$HOME/.config/tahoe-glass/state"
glass_state() { sed -n "s/^$1=//p" "$GLASS_STATE" 2>/dev/null | tail -1; }
GLASS=0; [[ "$(glass_state enabled)" == 1 ]] && GLASS=1
GLASS_BAR="$(glass_state bar)"; GLASS_MENUS="$(glass_state menus)"
# glass mode (docs/liquid-glass.md): light uses MacTahoe Light (shell and GTK) and the light colour
# scheme; dark and milky MacTahoe Dark. Older state files said tint=dark|light.
GLASS_MODE="$(glass_state mode)"
[[ -z "$GLASS_MODE" ]] && { [[ "$(glass_state tint)" == dark ]] && GLASS_MODE=dark || GLASS_MODE=milky; }
[[ "$GLASS" == 1 ]] || GLASS_MODE=milky
if [[ "$GLASS_MODE" == light ]]; then
  SHELL_THEME=MacTahoe-Light; GTK3_THEME=MacTahoe-Light-solid; COLOR_SCHEME=default
else
  SHELL_THEME=MacTahoe-Dark; GTK3_THEME=MacTahoe-Dark-solid; COLOR_SCHEME=prefer-dark
fi
[[ "$GLASS" == 1 ]] && EXTS+=(openbar@neuromorph)
case "${1:-}" in
  --gdm)
    # Login screen: needs root, so only print what to run.
    cat <<EOT
The login screen is GDM's own shell; it is themed by the MacTahoe tweaks script (root):
  sudo systemctl disable plasmalogin.service && sudo systemctl enable gdm.service   # once, if still on Plasma's login
  cd ~/.local/src/MacTahoe-gtk-theme && sudo ./tweaks.sh -g -i apple -c Dark
Options after -g: -b IMAGE (own background), -nb (no blur), -nd (no darken), -p 45 (panel opacity).
Undo: sudo ./tweaks.sh -g -r
GNOME updates can overwrite the GDM theme; rerun the tweaks command if the login screen reverts.
EOT
    exit 0 ;;
esac
WANT="['user-theme@gnome-shell-extensions.gcampax.github.com','dash-to-dock@micxgx.gmail.com','blur-my-shell@aunetx','appindicatorsupport@rgcjonas.gmail.com','rounded-window-corners@fxgn','nowplaying@epogonii.github.io','Vitals@CoreCoding.com']"
[[ "$GLASS" == 1 ]] && WANT="${WANT%]},'openbar@neuromorph']"
# desktop widgets (scripts/tahoe-widgets.sh): kept on while installed and switched on
[[ -d "$EXT_DIR/tahoe-widgets@cachyos-tahoe" && "$(glass_state widgets)" == on ]] && WANT="${WANT%]},'tahoe-widgets@cachyos-tahoe']"
# Control Center (scripts/tahoe-control-center.sh): kept on while installed and switched on
[[ -d "$EXT_DIR/tahoe-control-center@cachyos-tahoe" && "$(glass_state controlcenter)" == on ]] && WANT="${WANT%]},'tahoe-control-center@cachyos-tahoe']"
# open and close animations (scripts/tahoe-motion.sh): kept on while installed and switched on
[[ -d "$EXT_DIR/tahoe-motion@cachyos-tahoe" && "$(glass_state motion)" == on ]] && WANT="${WANT%]},'tahoe-motion@cachyos-tahoe']"
# the frame probe (tools/tahoe-probe@cachyos-tahoe, measuring only): kept on while it is on
[[ -d "$EXT_DIR/tahoe-probe@cachyos-tahoe" ]] && gsettings get org.gnome.shell enabled-extensions | grep -q "'tahoe-probe@cachyos-tahoe'" && WANT="${WANT%]},'tahoe-probe@cachyos-tahoe']"
SHELL_VER="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
changed=0

# 1. theme files
if [[ ! -f "$HOME/.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css" || ! -L "$HOME/.config/gtk-4.0/gtk.css" ]]; then
  log "theme missing: rebuilding (one run, blur variant, libadwaita)"
  [[ -d "$SRC" ]] || git clone -q --depth 1 https://github.com/vinceliuice/MacTahoe-gtk-theme "$SRC"
  rm -rf /tmp/MacTahoe.lock
  ( cd "$SRC" && TERM=xterm-256color script -qfec "./install.sh -b -l" /dev/null >/dev/null 2>&1 )
  changed=1
fi

# 2. extension folders
for e in "${EXTS[@]}"; do
  if [[ ! -f "$EXT_DIR/$e/metadata.json" ]]; then
    log "extension folder missing: $e, fetching for GNOME $SHELL_VER"
    tag="$(curl -s "https://extensions.gnome.org/extension-info/?uuid=$e&shell_version=$SHELL_VER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version_tag"])' 2>/dev/null || true)"
    if [[ -n "$tag" ]]; then
      tmp="$(mktemp -d)"; curl -sL "https://extensions.gnome.org/download-extension/$e.shell-extension.zip?version_tag=$tag" -o "$tmp/e.zip"
      mkdir -p "$EXT_DIR/$e"; python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/e.zip" "$EXT_DIR/$e"
      [[ -d "$EXT_DIR/$e/schemas" ]] && glib-compile-schemas "$EXT_DIR/$e/schemas"; rm -rf "$tmp"; changed=1
    else
      log "no build of $e for GNOME $SHELL_VER yet (normal for a few days after a GNOME major update)"
    fi
  fi
done

# 3. loaded in the running shell
for e in "${EXTS[@]}"; do
  if ! gnome-extensions info "$e" >/dev/null 2>&1; then
    log "shell has not loaded $e: asking it to"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.InstallRemoteExtension "$e" >/dev/null 2>&1 || true
    changed=1
  fi
done

# 4. enabled
cur="$(gsettings get org.gnome.shell enabled-extensions | tr -d " ")"
if [[ "$cur" != "$(tr -d ' ' <<<"$WANT")" ]]; then
  log "enabling the extension set"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "$WANT"; changed=1
fi
for e in "${EXTS[@]}"; do
  st="$(gnome-extensions info "$e" 2>/dev/null | awk '/State:/{print $2}')"
  if [[ "$st" == "INACTIVE" ]]; then log "re-enabling $e"; gnome-extensions enable "$e" 2>/dev/null; changed=1
  elif [[ "$st" == "ERROR" ]]; then log "$e is in ERROR; its code changed on disk and the shell needs a logout to reload it"; fi
done

# 5. shell theme applied and loaded
if [[ "$(gsettings get org.gnome.shell.extensions.user-theme name)" != "'$SHELL_THEME'" ]]; then
  log "shell theme not set: applying"; changed=1
fi
last="$(journalctl --user -b --no-pager -o cat 2>/dev/null | grep -E 'loading (user|default) theme' | tail -1)"
if [[ "$changed" == 1 || "$last" == *Adwaita* ]]; then
  log "re-applying shell theme (last load: ${last:-unknown})"
  gsettings set org.gnome.shell.extensions.user-theme name ''; sleep 1
  gsettings set org.gnome.shell.extensions.user-theme name "$SHELL_THEME"
fi
# GTK3 apps (pywebview, Electron-with-GTK headers, older apps) use the solid
# variant: filled header bars. libadwaita apps keep the blur variant through
# the gtk-4.0 config, which is independent of this setting.
[[ "$(gsettings get org.gnome.desktop.interface gtk-theme)" == "'$GTK3_THEME'" ]] || { log "gtk3 theme drifted: resetting to $GTK3_THEME"; gsettings set org.gnome.desktop.interface gtk-theme "$GTK3_THEME"; }
# libadwaita apps read ~/.config/gtk-4.0/gtk.css: the Light file in light mode, Dark otherwise
gtk4_want="$HOME/.config/gtk-4.0/gtk-$([[ "$GLASS_MODE" == light ]] && echo Light || echo Dark).css"
if [[ -f "$gtk4_want" && "$(readlink -f "$HOME/.config/gtk-4.0/gtk.css")" != "$gtk4_want" ]]; then
  log "gtk4 stylesheet drifted: pointing gtk.css at $(basename "$gtk4_want")"; ln -sfn "$gtk4_want" "$HOME/.config/gtk-4.0/gtk.css"
fi
# light mode carries the shell overrides over to MacTahoe Light too (glass-bar.sh does it)
if [[ "$GLASS_MODE" == light ]] && ! grep -qs "tahoe-overrides:" "$HOME/.themes/MacTahoe-Light/gnome-shell/gnome-shell.css"; then
  log "shell overrides missing from MacTahoe Light: re-applying the light mode"; bash "$ROOT/scripts/glass-bar.sh" mode light >/dev/null
fi
# 5b. shell CSS overrides (quick settings icon size, Now Playing card, the Liquid Glass radii and
#     row colours from tokens/) survive a theme rebuild, and pick up rules added to the repo
#     copy since; glass-bar.sh renders them with the tokens into both shell themes
CSS="$HOME/.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css"
if [[ -f "$CSS" && -f "$ROOT/config/gnome-shell-overrides.css" ]]; then
  grep -q '.lightbox { background-color: transparent; }' "$CSS" && sed -i '/tahoe-overrides:/,/end tahoe-overrides/d' "$CSS"
  out=$(bash "$ROOT/scripts/glass-bar.sh" overrides 2>&1) || log "shell CSS overrides failed: $out"
  [[ -n "$out" ]] && log "re-applied shell CSS overrides"
fi

# 5b2. No popup blur: the Control Center and every dropdown use the plain
#      tint in the shell overrides. An extension carrying the earlier Tahoe
#      patches (quick settings blurred per piece, app popovers blurred with
#      their window) is refetched clean; 5c then re-applies only the modal
#      dialog patch. The GTK4 popover translucency that let that blur show
#      comes out of the GTK4 theme.
BMS="$EXT_DIR/blur-my-shell@aunetx"
if grep -qs "tahoe: quick settings\|tahoe: a popup menu\|tahoe: fixed radius" "$BMS/components/popup/targets.js" "$BMS/components/popup/blur_surface.js" "$BMS/components/applications.js"; then
  tag="$(curl -s "https://extensions.gnome.org/extension-info/?uuid=blur-my-shell@aunetx&shell_version=$SHELL_VER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version_tag"])' 2>/dev/null || true)"
  if [[ -n "$tag" ]]; then
    log "Blur my Shell carries the old popup blur patches: refetching a clean build (takes effect at next login)"
    tmp="$(mktemp -d)"; curl -sL "https://extensions.gnome.org/download-extension/blur-my-shell@aunetx.shell-extension.zip?version_tag=$tag" -o "$tmp/e.zip"
    rm -rf "${BMS:?}"; mkdir -p "$BMS"; python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/e.zip" "$BMS"
    [[ -d "$BMS/schemas" ]] && glib-compile-schemas "$BMS/schemas"; rm -rf "$tmp"; changed=1
  else
    log "Blur my Shell carries the old popup blur patches, but no clean build could be fetched; try again online"
  fi
fi
GT4="$HOME/.config/gtk-4.0/gtk-Dark.css"
if grep -qs "tahoe-gtk4-overrides:" "$GT4"; then
  log "removing the GTK4 popover translucency (apps pick it up when reopened)"
  python3 - "$GT4" <<'PY'
import sys,re
css=open(sys.argv[1]).read()
open(sys.argv[1],"w").write(re.sub(r"\n*/\* tahoe-gtk4-overrides:.*?/\* end tahoe-gtk4-overrides \*/\n?","\n",css,flags=re.S))
PY
fi

# 5c. Blur my Shell patch: modal dialogs (power off, log out, run) are
#     full-screen surfaces, so blurring them blurs and darkens the whole
#     screen. Take them out of the popup module's surface lists. Re-applied
#     after any refetch of the extension.
BSF="$EXT_DIR/blur-my-shell@aunetx/components/popup/blur_surface.js"
if [[ -f "$BSF" ]] && { grep -q "'modal-dialog'" "$BSF" || grep -q "\['modal-dialog', 'run-dialog'\]" "${BSF%blur_surface.js}targets.js"; }; then
  log "patching Blur my Shell: modal dialogs out of the blur surface lists"
  python3 - "$BSF" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    'modal-dialog', 'run-dialog',\n","")
s=s.replace("    'datemenu-popover', 'quick-settings', 'modal-dialog',","    'datemenu-popover', 'quick-settings',")
open(p,"w").write(s)
t=p.replace("blur_surface.js","targets.js"); u=open(t).read()
u=u.replace("        style_classes: ['modal-dialog', 'run-dialog'],","        style_classes: [],  /* tahoe: modal dialogs are not blurred */")
open(t,"w").write(u)
PY
  gnome-extensions disable blur-my-shell@aunetx 2>/dev/null; gnome-extensions enable blur-my-shell@aunetx 2>/dev/null
fi
# 5d. GTK3 windows: the theme rounds only the top corners (24px 24px 0 0).
#     Round all four so pywebview, Meld and other GTK3 apps match.
for f in "$HOME"/.themes/MacTahoe-*/gtk-3.0/gtk.css "$HOME"/.themes/MacTahoe-*/gtk-3.0/gtk-dark.css; do
  [[ -f "$f" ]] && grep -q 'border-radius: 24px 24px 0 0' "$f" && { log "rounding GTK3 bottom corners in $(basename "$(dirname "$(dirname "$f")")")"; sed -i 's/border-radius: 24px 24px 0 0/border-radius: 24px/g' "$f"; }
done

# 5e. Rounded Window Corners Reborn: its published build targets GNOME 50 and
#     fails on 51 (Shell.GLSLEffect was removed). Apply the GNOME 51 port of
#     its three shader-effect files (from upstream PR 175) after any refetch.
#     A running shell only picks the port up after a logout.
RWC="$EXT_DIR/rounded-window-corners@fxgn"
if [[ -d "$RWC/effect" && -d "$ROOT/config/rwc-gnome51" ]] && grep -q "gi://Shell" "$RWC/effect/rounded_corners_effect.js" 2>/dev/null; then
  log "porting Rounded Window Corners to GNOME 51 (logout to activate)"
  cp "$ROOT"/config/rwc-gnome51/*.js "$RWC/effect/"
  python3 - "$RWC/metadata.json" <<'PY'
import json,sys
p=sys.argv[1]; m=json.load(open(p)); m["shell-version"]=["51"]; json.dump(m,open(p,"w"),indent=4)
PY
fi
gsettings set org.gnome.shell disable-extension-version-validation true
RWS="$RWC/schemas"; RS=org.gnome.shell.extensions.rounded-window-corners-reborn
if [[ -d "$RWS" ]]; then
  gsettings --schemadir "$RWS" set $RS skip-libadwaita-app true
  gsettings --schemadir "$RWS" set $RS border-width 0
  gsettings --schemadir "$RWS" set $RS blacklist "['steam','VRChat.exe','vrmonitor']"
  gsettings --schemadir "$RWS" set $RS global-rounded-corner-settings "{'padding': <{'left': uint32 0, 'right': uint32 0, 'top': uint32 0, 'bottom': uint32 0}>, 'keepRoundedCorners': <{'maximized': false, 'fullscreen': false}>, 'borderRadius': <uint32 24>, 'smoothing': <0.0>, 'borderColor': <(0.5, 0.5, 0.5, 1.0)>, 'enabled': <true>}"
fi

# 5f. glass mode needs the patched Blur My Shell (per-piece quick settings blur, glass
#     stylesheet). GNOME's updater or step 8 can replace it with a published build:
#     rebuild the patched one (it loads at the next login).
if [[ "$GLASS" == 1 ]] && ! grep -qs is_app_menu "$EXT_DIR/blur-my-shell@aunetx/components/applications/window_rules.js"; then
  log "Blur My Shell is not the patched glass build: rebuilding it (logout to activate)"
  bash "$ROOT/scripts/glass-bar.sh" rebuild >/dev/null 2>&1 || log "rebuild failed; run: bash $ROOT/scripts/glass-bar.sh rebuild"
  changed=1
fi

# 6. blur: the exact Blur my Shell module config. Applications blur on a
#    whitelist of system apps (static pipeline, works here); enable-all off.
BS="$EXT_DIR/blur-my-shell@aunetx/schemas"
if [[ -d "$BS" ]]; then
  # Compare as values, not text: gsettings prints 0.6 as 0.59999999999999998.
  bsg() {
    cur="$(gsettings --schemadir "$BS" get "org.gnome.shell.extensions.blur-my-shell$1" "$2")"
    if ! python3 - "$cur" "$3" <<'PY' 2>/dev/null
import sys
a, b = sys.argv[1].strip(), sys.argv[2].strip()
norm = lambda v: v.replace(" ", "")
try:
    same = abs(float(a) - float(b)) < 1e-6
except ValueError:
    same = norm(a) == norm(b)
sys.exit(0 if same else 1)
PY
    then log "blur$1 $2 drifted: resetting"; gsettings --schemadir "$BS" set "org.gnome.shell.extensions.blur-my-shell$1" "$2" "$3"; fi
  }
  bsg .applications blur true
  bsg .applications enable-all false
  if [[ "$GLASS" == 1 && "$(glass_state apps)" == on ]]; then
    # glass apps: live blur with the shared Liquid Glass (v76's blur engine draws it fine on
    # this GPU), rounded like the windows: 24 px, square when maximised
    bsg .applications static-blur false
    bsg .applications corner-radius 24; bsg .applications rounded-corners 0; bsg .applications corner-when-maximized false
  else
    bsg .applications static-blur true    # v75's dynamic mode painted the window opaque on this GPU; static shows what is behind, blurred
    bsg .applications corner-radius 16
  fi
  bsg .applications customize true
  if [[ "$GLASS" == 1 && "$(glass_state apps)" == on ]]; then
    if [[ "$(gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell.applications pipeline)" != "'pipeline_glassbar_apps'" ]] \
       || ! gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell pipelines | grep -q pipeline_glassbar_apps; then
      log "glass apps drifted: re-applying"; bash "$ROOT/scripts/glass-bar.sh" apps on >/dev/null
    fi
  elif [[ "$GLASS" == 1 ]]; then
    # v76 rounds corners per component, so its upgrade folds "Default rounded" into "Default";
    # hacks-level and the per-component sigma/brightness are gone (kept only for migration)
    bsg .applications pipeline "'pipeline_default'"
  else
    bsg .applications pipeline "'pipeline_default_rounded'"
    bsg "" hacks-level 0
  fi
  # every installed GTK3 and GTK4 app: the glass blocks make their backgrounds translucent, so each
  # needs the live blur behind it (scripts/glass-app-ids.py finds them; new apps at the next login)
  bsg .applications whitelist "$(python3 "$ROOT/scripts/glass-app-ids.py")"
  if [[ "$GLASS" == 1 && "$(glass_state apps)" == on ]]; then
    # glass apps. light/dark: GTK4 backgrounds are translucent (the glass block in the mode's
    # GTK4 stylesheet), so windows stay fully opaque. milky: windows at 215, no block.
    if [[ "$GLASS_MODE" == milky ]]; then
      bsg .applications opacity 215
      if grep -qs "tahoe-glass-gtk4" "$HOME/.config/gtk-4.0/gtk-Dark.css" "$HOME/.config/gtk-4.0/gtk-Light.css"; then
        log "GTK4 glass block present in milky mode: removing"; bash "$ROOT/scripts/glass-bar.sh" apps on >/dev/null
      fi
    else
      bsg .applications opacity 255
      gtk4_css="$HOME/.config/gtk-4.0/gtk-$([[ "$GLASS_MODE" == light ]] && echo Light || echo Dark).css"
      if [[ -f "$gtk4_css" ]] && ! grep -q "mode: $GLASS_MODE; menus: glass;" "$gtk4_css"; then
        log "GTK4 glass block missing or for another mode: re-applying"; bash "$ROOT/scripts/glass-bar.sh" apps on >/dev/null
      fi
      # GTK3 apps (Disks, pywebview apps): the glass block in the user GTK3 stylesheet, for this mode
      if ! grep -s -A1 "tahoe-glass-gtk3: managed" "$HOME/.config/gtk-3.0/gtk.css" | grep -q "mode: $GLASS_MODE "; then
        log "GTK3 glass block missing or for another mode: re-applying"; bash "$ROOT/scripts/glass-bar.sh" apps on >/dev/null
      fi
    fi
  else
    bsg .applications opacity 215
  fi
  [[ "$GLASS" == 1 ]] || { bsg .applications sigma 30; bsg .applications brightness 0.6; }
  # Shell surfaces, per the theme author's Blur my Shell screenshot.
  if [[ "$GLASS" == 1 ]]; then
    # glass bar: rounded static blur of the wallpaper with Liquid Glass (or plain, after 'glass-bar.sh glass off')
    bsg .panel blur true; bsg .panel static-blur true; bsg .panel override-background true
    bsg .panel style-panel 0; bsg .panel corner-radius 50; bsg .panel rounded-corners 0
    bsg .panel unblur-in-overview true
    bar_pipe="$(gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell.panel pipeline)"
    if [[ "$bar_pipe" != "'pipeline_glassbar_glass'" && "$bar_pipe" != "'pipeline_glassbar_plain'" ]] \
       || ! gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell pipelines | grep -q "${bar_pipe//\'/}"; then
      log "glass bar pipeline missing: recreating"
      if [[ "$GLASS_BAR" == plain ]]; then bash "$ROOT/scripts/glass-bar.sh" glass off >/dev/null; else bash "$ROOT/scripts/glass-bar.sh" glass on >/dev/null; fi
    elif [[ "$GLASS_BAR" == plain && "$bar_pipe" != "'pipeline_glassbar_plain'" ]] || [[ "$GLASS_BAR" != plain && "$bar_pipe" != "'pipeline_glassbar_glass'" ]]; then
      log "glass bar drifted from '$GLASS_BAR': resetting"
      if [[ "$GLASS_BAR" == plain ]]; then bash "$ROOT/scripts/glass-bar.sh" glass off >/dev/null; else bash "$ROOT/scripts/glass-bar.sh" glass on >/dev/null; fi
    fi
  else
    bsg .panel blur false; bsg .panel override-background true; bsg .panel unblur-in-overview true
  fi
  bsg .overview blur true; bsg .overview style-components 0
  bsg .appfolder blur true; bsg .appfolder style-dialogs 1
  [[ "$GLASS" == 1 ]] || bsg .appfolder sigma 30
  if [[ "$GLASS" == 1 && "$(glass_state dock)" == on ]]; then
    # glass dock: live blur with the shared Liquid Glass, the theme's dock background cleared
    bsg .dash-to-dock blur true; bsg .dash-to-dock static-blur false
    bsg .dash-to-dock override-background true; bsg .dash-to-dock style-dash-to-dock 0
    bsg .dash-to-dock unblur-in-overview true
    if [[ "$(gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell.dash-to-dock pipeline)" != "'pipeline_glassbar_dock'" ]] \
       || ! gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell pipelines | grep -q pipeline_glassbar_dock; then
      log "glass dock drifted: re-applying"; bash "$ROOT/scripts/glass-bar.sh" dock on >/dev/null
    fi
  else
    bsg .dash-to-dock blur true; bsg .dash-to-dock static-blur true
    if [[ "$GLASS" == 1 ]]; then bsg .dash-to-dock pipeline "'pipeline_default'"; else bsg .dash-to-dock pipeline "'pipeline_default_rounded'"; fi
    bsg .dash-to-dock override-background false; bsg .dash-to-dock unblur-in-overview true
  fi
  if [[ "$GLASS" == 1 && "$GLASS_MENUS" == on ]]; then
    # glass menus: live blur on each menu and each quick settings piece, the top bar's Liquid Glass
    bsg .popup blur true; bsg .popup static-blur false; bsg .popup override-background true
    bsg .popup preserve-shell-theme false
    # popups keep a live blur while they open, close or resize: a frozen one showed the backdrop of
    # where the menu was before (user, 2026-10-19; docs/gnome-tahoe/animations.md)
    if gsettings --schemadir "$BS" list-keys org.gnome.shell.extensions.blur-my-shell.popup | grep -qx motion-freeze; then
      bsg .popup motion-freeze false
    fi
    if [[ "$GLASS_MODE" == light ]]; then bsg .popup style-popup 1; else bsg .popup style-popup 3; fi
    if [[ "$(gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell.popup pipeline)" != "'pipeline_glassbar_menus'" ]] \
       || ! gsettings --schemadir "$BS" get org.gnome.shell.extensions.blur-my-shell pipelines | grep -q pipeline_glassbar_menus; then
      log "glass menus drifted: re-applying"; bash "$ROOT/scripts/glass-bar.sh" menus on >/dev/null
    fi
    # the glass at the CSS shape's radius (tokens/radius.json, docs/STANDARD.md)
    while read -r sec key want; do
      if [[ "$(gsettings --schemadir "$BS" get "org.gnome.shell.extensions.blur-my-shell.$sec" "$key")" != "$want" ]]; then
        log "glass radius $sec/$key drifted: re-applying the tokens"; bash "$ROOT/scripts/glass-bar.sh" radii >/dev/null; break
      fi
    done < <(python3 "$ROOT/scripts/glass-tokens.py" bms)
  else
    # Popups (quick settings, menus, notifications) are not blurred: they
    # use the plain tint in the shell overrides.
    bsg .popup blur false
  fi
fi

# 6b. desktop-entry overrides (window class for Steam games so the dock matches the running window)
for f in "$ROOT"/overrides/*.desktop; do [[ -f "$f" ]] || continue; d="$HOME/.local/share/applications/$(basename "$f")"; cmp -s "$f" "$d" || { log "restoring $(basename "$f")"; cp "$f" "$d"; update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true; }; done

# 7. icons: theme selected and present (it is a symlink into the repo)
if [[ ! -f "$HOME/.local/share/icons/Tahoe-Material/index.theme" && -d "$ROOT/icons/Tahoe-Material" ]]; then
  log "icon theme link missing: restoring"; mkdir -p "$HOME/.local/share/icons"
  ln -sfn "$ROOT/icons/Tahoe-Material" "$HOME/.local/share/icons/Tahoe-Material"; changed=1
fi
[[ "$(gsettings get org.gnome.desktop.interface icon-theme)" == "'Tahoe-Material'" ]] || { [[ -d "$HOME/.local/share/icons/Tahoe-Material" ]] && { log "icon theme not set: applying"; gsettings set org.gnome.desktop.interface icon-theme 'Tahoe-Material'; }; }
# KDE apps (Dolphin, Kate, Konsole) read kdeglobals: the companion theme adds SF places icons
if [[ -d "$ROOT/icons/Tahoe-Material-KDE" ]]; then
  [[ -L "$HOME/.local/share/icons/Tahoe-Material-KDE" ]] || { log "KDE companion icon theme link missing: restoring"; ln -sfn "$ROOT/icons/Tahoe-Material-KDE" "$HOME/.local/share/icons/Tahoe-Material-KDE"; }
  [[ "$(kreadconfig6 --file kdeglobals --group Icons --key Theme 2>/dev/null)" == "Tahoe-Material-KDE" ]] || { log "KDE icon theme not set: applying"; kwriteconfig6 --file kdeglobals --group Icons --key Theme Tahoe-Material-KDE; }
fi

# 8. extension builds vs running shell: after a GNOME major update the old
#    build is refused; fetch the one for this version when it exists.
for e in "${EXTS[@]}"; do
  # Open Bar's newest build stops at GNOME 49; it loads here because version validation is off (5e)
  [[ "$e" == openbar@neuromorph ]] && continue
  m="$EXT_DIR/$e/metadata.json"; [[ -f "$m" ]] || continue
  if ! python3 -c 'import json,sys; sys.exit(0 if sys.argv[2] in json.load(open(sys.argv[1]))["shell-version"] else 1)' "$m" "$SHELL_VER" 2>/dev/null; then
    tag="$(curl -s "https://extensions.gnome.org/extension-info/?uuid=$e&shell_version=$SHELL_VER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version_tag"])' 2>/dev/null || true)"
    if [[ -n "$tag" ]]; then
      log "$e is built for another GNOME; fetching the GNOME $SHELL_VER build"
      tmp="$(mktemp -d)"; curl -sL "https://extensions.gnome.org/download-extension/$e.shell-extension.zip?version_tag=$tag" -o "$tmp/e.zip"
      rm -rf "${EXT_DIR:?}/${e:?}"; mkdir -p "$EXT_DIR/$e"; python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/e.zip" "$EXT_DIR/$e"
      [[ -d "$EXT_DIR/$e/schemas" ]] && glib-compile-schemas "$EXT_DIR/$e/schemas"; rm -rf "$tmp"
      gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Extensions.InstallRemoteExtension "$e" >/dev/null 2>&1 || true
      changed=1
    else
      log "$e has no GNOME $SHELL_VER build yet; it stays disabled until one is published"
    fi
  fi
done

# 9. interface drift
gs() { [[ "$(gsettings get "$1" "$2")" == "$3" ]] || { log "$2 drifted: resetting"; gsettings set "$1" "$2" "${3//\'/}"; }; }
gs org.gnome.desktop.interface cursor-theme "'MacTahoe-dark'"
gs org.gnome.desktop.interface color-scheme "'$COLOR_SCHEME'"
gs org.gnome.desktop.wm.preferences button-layout "'close,minimize,maximize:'"
# Resize handles: Mutter's default 10 px grab area falls inside the 24 px
# rounded-corner clip, so corners cannot be grabbed. Widen it past the radius.
gs org.gnome.mutter draggable-border-width 28
# System font: Tahoe's SF Pro Text, once the user has installed it (scripts/sf-fonts.sh)
if [[ -n "$(fc-list 'SF Pro Text' family)" ]]; then
  gs org.gnome.desktop.interface font-name "'SF Pro Text 10'"
  gs org.gnome.desktop.interface document-font-name "'SF Pro Text 11'"
  gs org.gnome.desktop.wm.preferences titlebar-font "'SF Pro Text Bold 10'"
fi
# Wallpaper is deliberately not touched: the user picks it.

# 10. dock drift: the theme styles the dock; Dash to Dock must not override it
DD="$EXT_DIR/dash-to-dock@micxgx.gmail.com/schemas"
if [[ -d "$DD" ]]; then
  ddg() { [[ "$(gsettings --schemadir "$DD" get org.gnome.shell.extensions.dash-to-dock "$1")" == "$2" ]] || { log "dock $1 drifted: resetting"; gsettings --schemadir "$DD" set org.gnome.shell.extensions.dash-to-dock "$1" "${2//\'/}"; }; }
  ddg apply-custom-theme false; ddg transparency-mode "'DEFAULT'"; ddg custom-background-color false; ddg dock-position "'BOTTOM'"
fi

# 11. dock stylesheet: the theme's "tweaks.sh -d" renames it, which breaks Dash to Dock 110
if [[ -f "$EXT_DIR/dash-to-dock@micxgx.gmail.com/stylesheet.css.bak" && ! -f "$EXT_DIR/dash-to-dock@micxgx.gmail.com/stylesheet.css" ]]; then
  log "restoring Dash to Dock stylesheet"; mv "$EXT_DIR/dash-to-dock@micxgx.gmail.com/stylesheet.css.bak" "$EXT_DIR/dash-to-dock@micxgx.gmail.com/stylesheet.css"
  gnome-extensions disable dash-to-dock@micxgx.gmail.com; gnome-extensions enable dash-to-dock@micxgx.gmail.com
fi

# 12. icon theme contents: the generated set must exist and carry the current
#     layout (symbolic places for Files' sidebar, KDE companion). Regenerate
#     from the repo tokens when it does not; glyphs are fetched if missing.
# (only in a checkout that carries the icon generator: liquid-glass leaves the icons to
#  cachyos-tahoe-theme, where the installed theme links)
if [[ -f "$ROOT/scripts/gen-app-icons.py" ]] && { [[ ! -f "$ROOT/icons/Tahoe-Material/symbolic/places/user-home-symbolic.svg" ]] || [[ ! -f "$ROOT/icons/Tahoe-Material-KDE/index.theme" ]] || [[ ! -f "$ROOT/icons/Tahoe-Material/apps/scalable/org.gnome.Nautilus.svg" ]] || [[ ! -f "$ROOT/icons/Tahoe-Material/places/scalable/folder-documents.svg" ]]; }; then
  log "icon theme incomplete: regenerating from tokens"
  ( cd "$ROOT" && python3 scripts/fetch-glyphs.py >/dev/null 2>&1; python3 scripts/gen-action-icons.py >/dev/null 2>&1; python3 -W ignore scripts/gen-app-icons.py --no-sheet >/dev/null 2>&1 )
  gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/Tahoe-Material" 2>/dev/null || true
  gsettings set org.gnome.desktop.interface icon-theme 'Adwaita'; sleep 1; gsettings set org.gnome.desktop.interface icon-theme 'Tahoe-Material'
fi


# 12b. symbolic icons current with their tokens: gen-action-icons.py stamps
#      the hash of tokens/actions.json, tokens/glyphs.json and itself into
#      icons/Tahoe-Material/.generated-from. A changed SF mapping, stroke or
#      weight regenerates the set (new glyphs are fetched first).
STAMP="$ROOT/icons/Tahoe-Material/.generated-from"
want_hash="$(cd "$ROOT" && python3 -c 'import importlib.util,sys; s=importlib.util.spec_from_file_location("g","scripts/gen-action-icons.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.inputs_hash())' 2>/dev/null)"
if [[ -n "$want_hash" && "$(cat "$STAMP" 2>/dev/null)" != "$want_hash" ]]; then
  log "symbolic icons out of date with their tokens: regenerating"
  ( cd "$ROOT" && python3 scripts/fetch-glyphs.py >/dev/null 2>&1; python3 scripts/gen-action-icons.py >/dev/null 2>&1 )
  gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/Tahoe-Material" 2>/dev/null || true
  gsettings set org.gnome.desktop.interface icon-theme 'Adwaita'; sleep 1; gsettings set org.gnome.desktop.interface icon-theme 'Tahoe-Material'
fi

# 13. Now Playing Card settings drift (the macOS Now Playing layout set by
#     gnome-setup.sh); its look is in the shell overrides.
NPS="$EXT_DIR/nowplaying@epogonii.github.io/schemas"
if [[ -d "$NPS" ]]; then
  npg() { [[ "$(gsettings --schemadir "$NPS" get org.gnome.shell.extensions.nowplaying "$1")" == "$2" ]] || { log "now playing $1 drifted: resetting"; gsettings --schemadir "$NPS" set org.gnome.shell.extensions.nowplaying "$1" "${2//\'/}"; }; }
  npg location "'panel'"; npg panel-box "'right'"; npg panel-text "'none'"; npg panel-icon true
  npg card-layout "'full'"; npg cover-size "'large'"; npg show-progress true
  npg show-volume false; npg show-loop-shuffle false; npg equalizer-accent false
fi

# 14. Vitals settings drift (the top-bar readings set by gnome-setup.sh)
VTS="$EXT_DIR/Vitals@CoreCoding.com/schemas"
if [[ -d "$VTS" ]]; then
  vtg() { [[ "$(gsettings --schemadir "$VTS" get org.gnome.shell.extensions.vitals "$1")" == "$2" ]] || { log "vitals $1 drifted: resetting"; gsettings --schemadir "$VTS" set org.gnome.shell.extensions.vitals "$1" "$3"; }; }
  vtg hot-sensors "['__temperature_max__', '_processor_usage_', '_gpu#1_utilization_', '_memory_usage_']" "['__temperature_max__', '_processor_usage_', '_gpu#1_utilization_', '_memory_usage_']"
  vtg show-gpu true true; vtg include-public-ip false false
fi

# 15. glass bar mode: Open Bar draws only the floating pill. Its menu, notification,
#     GTK and font styling stay off so MacTahoe keeps styling everything else.
OBS="$EXT_DIR/openbar@neuromorph/schemas"
if [[ "$GLASS" == 1 && -d "$OBS" ]]; then
  obg() { [[ "$(gsettings --schemadir "$OBS" get org.gnome.shell.extensions.openbar "$1")" == "$2" ]] || { log "open bar $1 drifted: resetting"; gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar "$1" "${2//\'/}"; }; }
  obg bartype "'Floating'"; obg menustyle false
  obg apply-menu-shell false; obg apply-menu-notif false; obg apply-all-shell false; obg apply-accent-shell false
  obg apply-gtk false; obg apply-flatpak false; obg gtk-popover false; obg set-yarutheme false
  obg set-notifications false; obg set-notif-position false; obg set-overview false
  obg wmaxbar false   # the bar stays a floating capsule when a window is maximised
  # bar font: the interface font at regular weight, as Tahoe's menu bar (glass-bar.sh apply)
  ob_font="'$(gsettings get org.gnome.desktop.interface font-name | tr -d "'")'"
  if [[ "$(gsettings --schemadir "$OBS" get org.gnome.shell.extensions.openbar font)" != "$ob_font" ]]; then
    log "open bar font drifted: resetting"; gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar font "$ob_font"
    # rebuild Open Bar's stylesheet with the font
    t=$([[ "$(gsettings --schemadir "$OBS" get org.gnome.shell.extensions.openbar trigger-reload)" == true ]] && echo false || echo true)
    gsettings --schemadir "$OBS" set org.gnome.shell.extensions.openbar trigger-reload "$t"
  fi
fi

log "done"
