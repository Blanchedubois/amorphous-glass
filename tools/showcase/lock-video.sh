#!/bin/bash
# lock-video.sh OUTDIR [dark|light]: the lock screen for the showcase montage, recorded at 60 fps.
#
# GNOME stops screencasts while the real session is locked, so the montage's old lock clips were
# screenshots at about one frame a second. This records a throwaway headless shell instead
# (tools/lockscreen/run.sh: its own XDG dirs and D-Bus session, the user's wallpaper, lock picture
# and Blur My Shell, main's tahoe-lockscreen) with the lock-test driver's video gate: GNOME's own
# screencast of that shell, Super+L's animated lock, the clock and widgets with music playing (the
# showcase's fake player and cover: no song's words or artwork), the prompt woken and dots typed.
# The shell sees the system bus only through tools/gdm/sysbus.sh, so nothing it does reaches the
# real GDM or PAM; run.sh also refuses to start after a recent PAM failure (faillock).
#
# TAHOE_LOCK_PLAYER= (empty): no music, so the lock shows the wallpaper rather than music mode's swirl.
#
# Output: OUTDIR/lock-video.mp4 and the driver's log (marks: lock, wake, type, stop; seconds from the
# recording's start).
set -eu
out=$(realpath -m "$1"); mode=${2:-dark}
H=$(cd "$(dirname "$0")" && pwd); R=$(cd "$H/../.." && pwd)
mkdir -p "$out"
[ -f "$H/fake-track/cover.png" ] || python3 "$H/fakeplayer.py" --make-assets
# TAHOE_SHOWCASE_SONG=song.json: the song's name and cover on Now Playing (as montage_shoot.py)
art=$H/fake-track/cover.png
if [ -n "${TAHOE_SHOWCASE_SONG:-}" ]; then
  eval "$(python3 -I - "$TAHOE_SHOWCASE_SONG" <<'PY'
import json, shlex, sys, os
s = json.load(open(sys.argv[1]))
cover = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), s['cover'])
print(f"art={shlex.quote(cover)}; export TAHOE_LOCK_TITLE={shlex.quote(s['title'])} TAHOE_LOCK_ARTIST={shlex.quote(s['artist'])}")
PY
)"
fi
TAHOE_TEST_PIPEWIRE=1 TAHOE_TEST_TIMEOUT=${TAHOE_TEST_TIMEOUT:-90} TAHOE_LOCK_MONITOR=2560x1440@60 TAHOE_LOCK_PLAYER=${TAHOE_LOCK_PLAYER-1} \
  TAHOE_LOCK_ART="$art" TAHOE_LOCK_GATE=video TAHOE_LOCK_TAG=video \
  TAHOE_TEST_EXT_DIRS="${TAHOE_TEST_EXT_DIRS:-$R/extensions/tahoe-lockscreen@cachyos-tahoe}" \
  "$R/tools/lockscreen/run.sh" "$out" "$mode"
grep '"video' "$out/log-video.jsonl" || { echo "lock-video: no recording (see $out/shell-video.log)" >&2; exit 1; }
mv "$out/lock-video-take.mp4" "$out/lock-video.mp4"
ls -l "$out/lock-video.mp4"
du -h "$out/shell-video.log"
