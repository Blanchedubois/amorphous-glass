#!/usr/bin/env bash
# Tahoe Liquid Glass widgets on the desktop (extensions/tahoe-widgets@cachyos-tahoe).
# They draw their glass with the patched Blur My Shell that glass-bar.sh installs, follow its
# light/dark/milky mode, and never touch the top bar. Everything stays in your home folder.
#
#   bash tahoe-widgets.sh on      install (or update) and switch on; a new install needs a LOGOUT
#   bash tahoe-widgets.sh off     switch off (instant); the files stay
#   bash tahoe-widgets.sh status
#   bash tahoe-widgets.sh calendar-url          set the Schedule widgets' calendar link (asks for it,
#                                               hidden; or pipe it in). Stored in the GNOME keyring,
#                                               else in a private file, never in this repo
#   bash tahoe-widgets.sh calendar-url --clear  forget the link and the cached events
#
# tahoe-repair keeps the widgets enabled while they are installed and switched on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=tahoe-widgets@cachyos-tahoe
SRC="$ROOT/extensions/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
STATE="$HOME/.config/tahoe-glass/state"
# the Schedule widgets' calendar link (extensions/.../icsfeed.js reads the same places)
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/tahoe-glass"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/tahoe-glass"
SECRET_ATTR=(tahoe-glass calendar-ics)

set_state() { # key value
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  if grep -q "^$1=" "$STATE"; then sed -i "s|^$1=.*|$1=$2|" "$STATE"; else echo "$1=$2" >> "$STATE"; fi
}
# enabled-extensions with UUID added (add) or removed (remove)
ext_list() {
  python3 -c 'import ast,sys
l = ast.literal_eval(sys.argv[1] or "[]")
l = [e for e in l if e != sys.argv[3]] + ([sys.argv[3]] if sys.argv[2] == "add" else [])
print(l)' "$(gsettings get org.gnome.shell enabled-extensions | sed 's/^@as //')" "$1" "$UUID"
}

# tells the widgets where the link is (keyring | file | none); they watch this file
calendar_source() {
  ( umask 077; mkdir -p "$CONF"; printf 'store=%s\nchanged=%s\n' "$1" "$(date +%s%N)" > "$CONF/calendar-source.tmp" )
  mv -f "$CONF/calendar-source.tmp" "$CONF/calendar-source"
}
# the old calendar's events must not show under a new link
calendar_forget_cache() { rm -f "$CACHE"/calendar.*; }

calendar_url() {
  local url store force_file=0
  case "${1:-}" in
    --clear)
      secret-tool clear "${SECRET_ATTR[@]}" 2>/dev/null || true
      rm -f "$CONF/calendar-url"
      calendar_forget_cache
      calendar_source none
      echo "Calendar link and cached events removed."
      return ;;
    --file) force_file=1 ;;
    "") ;;
    *) echo "usage: tahoe-widgets.sh calendar-url [--clear | --file]" >&2; return 1 ;;
  esac
  if [[ -t 0 ]]; then
    echo "Google Calendar: Settings > your calendar > Integrate calendar > Secret address in iCal format." >&2
    echo "Anyone with this address can read your calendar: keep it to yourself." >&2
    printf 'Paste the address (hidden), then Enter: ' >&2
    IFS= read -rs url || true
    echo >&2
  else
    IFS= read -r url || true
  fi
  url="${url#"${url%%[![:space:]]*}"}"; url="${url%"${url##*[![:space:]]}"}"
  if [[ ! "$url" =~ ^(https|webcal)://[^[:space:]/]+/[^[:space:]]*$ ]]; then
    unset url
    echo "That doesn't look like an https:// or webcal:// address. Nothing was saved." >&2
    return 1
  fi
  # through stdin, never as an argument (arguments show in ps)
  if [[ "$force_file" == 0 ]] && command -v secret-tool >/dev/null &&
     printf '%s' "$url" | secret-tool store --label='Tahoe Glass: calendar link (ICS)' "${SECRET_ATTR[@]}" 2>/dev/null; then
    rm -f "$CONF/calendar-url"
    store=keyring
  else
    ( umask 077; mkdir -p "$CONF"; printf '%s\n' "$url" > "$CONF/calendar-url.tmp" )
    mv -f "$CONF/calendar-url.tmp" "$CONF/calendar-url"
    secret-tool clear "${SECRET_ATTR[@]}" 2>/dev/null || true
    store=file
  fi
  unset url
  calendar_forget_cache
  calendar_source "$store"
  if [[ "$store" == keyring ]]; then
    echo "Saved in the GNOME keyring. The Schedule widgets load it in a moment."
  else
    echo "Saved in $CONF/calendar-url (only you can read it). The Schedule widgets load it in a moment."
  fi
}

case "${1:-}" in
  on)
    new=0; [[ -d "$DEST" ]] || new=1
    mkdir -p "$DEST"
    cp -r "$SRC/." "$DEST/"
    set_state widgets on
    gsettings set org.gnome.shell enabled-extensions "$(ext_list add)"
    if [[ "$new" == 1 ]]; then
      echo "Installed. Log out and back in: GNOME on Wayland loads new extensions only at login."
    else
      echo "Updated. Code changes load at the next login; the running widgets keep the old code."
    fi ;;
  off)
    set_state widgets off
    gsettings set org.gnome.shell enabled-extensions "$(ext_list remove)"
    echo "Widgets off." ;;
  status)
    echo "installed: $([[ -d "$DEST" ]] && echo yes || echo no)"
    echo "state: $(sed -n 's/^widgets=//p' "$STATE" 2>/dev/null | tail -1)"
    gnome-extensions info "$UUID" 2>/dev/null | grep State: || echo "shell: not loaded"
    echo "calendar link: $(sed -n 's/^store=//p' "$CONF/calendar-source" 2>/dev/null | tail -1 | grep . || echo none)" ;;
  calendar-url) calendar_url "${2:-}" ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
