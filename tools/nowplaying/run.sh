#!/bin/bash
# run.sh OUTDIR: the tahoe-nowplaying tests (nowplaying-test@local) in a throwaway headless
# gnome-shell: its own XDG dirs, runtime dir, keyfile settings and D-Bus session; it never touches
# the running desktop and never locks (no PAM, no GDM). Results: OUTDIR/results.jsonl, driver.log,
# shell.log. Exit status 0 when every test passed and the shell logged no unexpected JS error.
#   NP_ONLY=prefix   run only the tests whose name starts with it
#   EXT_DIR=path     the extension to test (default: this checkout's)
#   NP_MONITOR=WxH@R the virtual monitor (default 2560x1440@60)
set -eu
out=$(realpath -m "$1")
H=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$H/../.." && pwd)
extsrc=${EXT_DIR:-$R/extensions/tahoe-nowplaying@cachyos-tahoe}
root=$(mktemp -d -t tahoe-nowplaying-test.XXXX)
# a short runtime dir of its own (the socket path has a length limit), so the test shell never
# creates or deletes the real session's crash guard file in /run/user
export XDG_RUNTIME_DIR=$(mktemp -d "/tmp/nprun.XXXX")
chmod 700 "$XDG_RUNTIME_DIR"
"$H/check-shared.sh" >/dev/null
mkdir -p "$out"; rm -f "$out"/*.png "$out"/results.jsonl "$out"/driver.log "$out"/timing.jsonl
export XDG_CONFIG_HOME=$root/config XDG_CACHE_HOME=$root/cache XDG_DATA_HOME=$root/data XDG_STATE_HOME=$root/state
export GSETTINGS_BACKEND=keyfile NP_OUT=$out NP_FIXTURES=$H/fixtures
ext=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$ext" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
cp -r "$H/nowplaying-test@local" "$extsrc" "$ext/"
glib-compile-schemas "$ext/tahoe-nowplaying@cachyos-tahoe/schemas"
# the user's fonts (SF Pro, the SF Symbols' font) stay visible to fontconfig
ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"
cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<'KF'
[org/gnome/shell]
enabled-extensions=['tahoe-nowplaying@cachyos-tahoe', 'nowplaying-test@local']
disable-extension-version-validation=true
welcome-dialog-last-shown-version='999'
[org/gnome/desktop/interface]
color-scheme='prefer-dark'
[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false
[org/gnome/desktop/session]
idle-delay=uint32 0
KF
timeout ${NP_TIMEOUT:-180} dbus-run-session -- gnome-shell --headless --wayland --no-x11 --wayland-display "nptest-$$" \
  --virtual-monitor ${NP_MONITOR:-2560x1440@60} > "$out/shell.log" 2>&1 || true
# the test session's document portal mounts a FUSE file system in its runtime dir
fusermount3 -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || fusermount -uz "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$root" "$XDG_RUNTIME_DIR"

cat "$out/driver.log" 2>/dev/null || true
# JS errors from the extension, except the one the exception test injects on purpose
errors=$(grep -E "JS ERROR|tahoe-nowplaying:.*(Error|error)" "$out/shell.log" | grep -v "injected test failure" || true)
if [ -n "$errors" ]; then
  echo "unexpected errors in shell.log:"; echo "$errors" | head -20
fi
passed=$(grep -c '"ok":true' "$out/results.jsonl" 2>/dev/null || true)
failed=$(grep -c '"ok":false' "$out/results.jsonl" 2>/dev/null || true)
echo "passed ${passed:-0}, failed ${failed:-0}"
grep -q "^done, 0 failed" "$out/driver.log" 2>/dev/null && [ -z "$errors" ]
