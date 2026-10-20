# sysbus.sh: sourced by the test harnesses. sysbus_start gives the throwaway shell a filtered view
# of the system bus (xdg-dbus-proxy) WITHOUT GDM (org.gnome.DisplayManager) and fprintd, and
# exports DBUS_SYSTEM_BUS_ADDRESS for it; sysbus_stop ends the proxy.
#
# Why (2026-10-20): the lock and login screens in a test shell ask the REAL GDM daemon for the
# password conversation, so each run started a real gdm-password PAM check for the user; a shell
# exiting mid-check logs "conversation failed", which pam_faillock counts as a failed login, and
# three of them locked the user's account (sudo and the real lock screen) for 10 minutes.
# Of GDM the shell may only read the Manager's Version property (GNOME checks it before it builds a
# lock or login screen); every other call is refused by the proxy: OpenReauthenticationChannel
# and the greeter's session calls (the real PAM checks) and RegisterDisplay/RegisterSession (a
# test shell must not register itself with the real GDM). fprintd is not visible either.
# SYSBUS_LOG=file keeps the proxy's log of every call (tools/gdm checks it in its isolation test).
# Names the shell still needs (the user's name and avatar, network, power, sessions) stay visible.
SYSBUS_TALK="org.freedesktop.Accounts org.freedesktop.NetworkManager org.freedesktop.login1
  org.freedesktop.UPower org.freedesktop.UPower.PowerProfiles net.hadess.PowerProfiles
  org.freedesktop.hostname1 org.freedesktop.locale1 org.freedesktop.timedate1
  org.freedesktop.GeoClue2 org.freedesktop.RealtimeKit1 org.bluez org.freedesktop.PolicyKit1
  org.freedesktop.ModemManager1 org.freedesktop.Avahi org.freedesktop.systemd1"

sysbus_start() {
  local dir; dir=$(mktemp -d /tmp/sysbus.XXXX)
  SYSBUS_SOCK=$dir/bus
  local args=(--filter
    --see=org.gnome.DisplayManager
    "--call=org.gnome.DisplayManager=org.freedesktop.DBus.Properties.Get@/org/gnome/DisplayManager/Manager")
  for n in $SYSBUS_TALK; do args+=("--talk=$n"); done
  if [ -n "${SYSBUS_LOG:-}" ]; then
    xdg-dbus-proxy unix:path=/run/dbus/system_bus_socket "$SYSBUS_SOCK" "${args[@]}" --log > "$SYSBUS_LOG" 2>&1 &
  else
    xdg-dbus-proxy unix:path=/run/dbus/system_bus_socket "$SYSBUS_SOCK" "${args[@]}" &
  fi
  SYSBUS_PID=$!
  for _ in $(seq 50); do [ -S "$SYSBUS_SOCK" ] && break; sleep 0.1; done
  [ -S "$SYSBUS_SOCK" ] || { echo "sysbus: proxy did not start" >&2; return 1; }
  export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$SYSBUS_SOCK
}

sysbus_stop() {
  [ -n "${SYSBUS_PID:-}" ] && kill "$SYSBUS_PID" 2>/dev/null
  [ -n "${SYSBUS_SOCK:-}" ] && rm -rf "$(dirname "$SYSBUS_SOCK")"
  unset DBUS_SYSTEM_BUS_ADDRESS SYSBUS_PID SYSBUS_SOCK
}
