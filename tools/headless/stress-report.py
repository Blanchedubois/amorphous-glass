#!/usr/bin/env python3
# stress-report.py log.jsonl: the stress.sh table.
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
cases = [r for r in rows if 'case' in r]
print(f"{'case':52} {'opens':>5} {'morph':>5} {'jump':>4} {'frames':>6} {'p95':>5} {'max':>6} {'>12.5':>5} {'idle':>4}  {'handlers':>9} {'actors':>11} {'rss MB':>13}  stuck / error")
for r in cases:
    h, a, m = r['handlers'], r['actors'], r['rss_kb']
    note = ', '.join(r['stuck']) + (f" ERROR {r['error']}" if r.get('error') else '')
    print(f"{r['case'][:52]:52} {r.get('opens', 0) + r.get('app_maps', 0):>5} {r.get('morphed', '-')!s:>5} {r.get('max_jump', 0):>4} {r['frames']:>6} {r['p95']:>5} {r['max']:>6} {r['slow']:>5} {r['idle_frames']:>4}  "
          f"{h[0]!s:>4}>{h[1]!s:<4} {a[0]:>5}>{a[1]:<5} {m[0]/1024:>6.0f}>{m[1]/1024:<6.0f}  {note or 'ok'}")
for r in rows:
    if 'error' in r and 'case' not in r:
        print('driver error:', r['error'])
print('done' if any(r.get('done') for r in rows) else 'NOT DONE (timeout or crash)')
