#!/usr/bin/env python3
# analyze.py [LOG]: per scenario (label, kind, freeze) medians of the probe's JSON lines
import sys, json, os, statistics as st, re
log = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.cache/tahoe-probe.jsonl')
rows = {}
for line in open(log):
    d = json.loads(line)
    if 'probe' in d:
        continue
    label = re.sub(r'^panel:', '', d['label'])
    key = (label, d['kind'], d['bms'].get('freeze'))
    rows.setdefault(key, []).append(d)
med = lambda xs: round(st.median(xs), 1) if xs else '-'
print(f"{'scenario':<30}{'kind':<6}{'frz':<5}{'n':>3}{'first':>7}{'p50':>6}{'p95':>6}{'max':>7}{'drop':>5}{'cpu':>6}{'cpuMx':>7}{'over':>5}{'surf':>6}  top counters /frame")
for (label, kind, frz), ds in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1], str(kv[0][2]))):
    prof = {}
    for d in ds:
        for k, v in (d.get('prof') or {}).items():
            prof.setdefault(k, []).append(v[0] / max(1, d['frames']))
    top = ', '.join(f"{k} {med(v)}" for k, v in sorted(prof.items(), key=lambda kv: -st.median(kv[1]))[:4])
    print(f"{label[:29]:<30}{kind:<6}{str(frz)[:4]:<5}{len(ds):>3}"
          f"{med([d['first_frame_ms'] for d in ds if d['first_frame_ms'] is not None]):>7}"
          f"{med([d['interval_ms']['p50'] for d in ds if d['interval_ms']['p50']]):>6}"
          f"{med([d['interval_ms']['p95'] for d in ds if d['interval_ms']['p95']]):>6}"
          f"{max([d['interval_ms']['max'] or 0 for d in ds]):>7}"
          f"{med([d['dropped'] for d in ds]):>5}"
          f"{med([d['cpu_ms']['mean'] for d in ds]):>6}"
          f"{max(d['cpu_ms']['max'] for d in ds):>7}"
          f"{med([d['over_budget'] for d in ds]):>5}"
          f"{med([d.get('mapped', 0) for d in ds]):>6}  {top}")
