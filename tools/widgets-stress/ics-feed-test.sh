#!/bin/bash
# ics-feed-test.sh OUTDIR: the Schedule widgets' calendar feed test (widget-ics@local) in a
# throwaway headless shell, against ics-server.py on 127.0.0.1. Never uses the real feed or keyring.
# Fails if a check fails or the test link's marker shows up in any log.
set -eu
H=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "$1"); rm -f "$out/ics.jsonl"
TEST_KEYRING=1 SHOT_TIMEOUT=${SHOT_TIMEOUT:-180} DRIVER=widget-ics@local bash "$H/run.sh" "$out" "$H/layout-idle.json" >/dev/null
grep -h '"check"' "$out/ics.jsonl" | python3 -I -c 'import json,sys
for l in sys.stdin:
    d = json.loads(l); print(("ok  " if d["ok"] else "FAIL"), d["check"], "" if d["ok"] else {k: v for k, v in d.items() if k not in ("check", "ok")})'
! grep -q '"error"' "$out/ics.jsonl" && grep -q '"done":true,"failed":0' "$out/ics.jsonl" || { echo "FAILED: $(grep -h '"done"\|"error"' "$out/ics.jsonl")"; exit 1; }
if grep -l TESTSECRET "$out"/*.log "$out"/*.jsonl 2>/dev/null; then echo "FAILED: the link is in a log"; exit 1; fi
echo "all checks ok; the link is in no log"
