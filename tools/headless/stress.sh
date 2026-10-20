#!/bin/bash
# stress.sh BMS_ZIP OUTDIR: spam clicks and quick scrolls on every glass popup in a throwaway
# headless shell (run.sh), with tahoe-motion from this checkout and the user's dash-to-dock, then a
# table per case: frame stats, frames in the idle second after, anything left stuck, and counts
# before -> after (glass handlers, stage actors, shell RSS).
set -eu
H=$(cd "$(dirname "$0")" && pwd)
repo=${TAHOE_REPO:-$(cd "$H/../.." && pwd)}
TAHOE_TEST_ONLY=stress TAHOE_TEST_TIMEOUT=${TAHOE_TEST_TIMEOUT:-420} \
TAHOE_TEST_EXTS="dash-to-dock@micxgx.gmail.com" \
TAHOE_TEST_EXT_DIRS=$([ "${TAHOE_NO_MOTION:-}" ] || echo "$repo/extensions/tahoe-motion@cachyos-tahoe") \
  "$H/run.sh" "$1" "$2" 1
python3 "$H/stress-report.py" "$2/log.jsonl"
grep -E "JS ERROR|JS WARNING|Exception|TypeError" "$2/shell.log" | grep -v "tahoe-motion-test" | sort | uniq -c | sort -rn | head -20 || true
