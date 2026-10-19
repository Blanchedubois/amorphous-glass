import json, sys, statistics as st
def load(p):
    rows = {}
    for l in open(p):
        d = json.loads(l)
        if 'label' not in d or 'iv' not in d: 
            if 'error' in d or 'shot_error' in d or 'note' in d: print(p, d)
            continue
        rows.setdefault((d['label'], d['kind']), []).append(d)
    return rows
for p in sys.argv[1:]:
    print('==', p.split('/')[-2])
    print(f"{'scenario':<16}{'kind':<6}{'n':>3}{'first':>7}{'p50':>6}{'p95':>6}{'max':>6}{'slow':>6}{'upd ms':>8}{'upd n':>6}  other")
    for (lab, k), ds in load(p).items():
        ivs = [x for d in ds for x in d['iv'] if x <= 140]
        acc = []
        for d in ds:
            t = 0
            for x in d['iv']:
                t += x
                if t > 300: break
                if x <= 140: acc.append(x)
        s = sorted(ivs); q = lambda f: s[min(len(s)-1, int(len(s)*f))] if s else 0
        upd = [d['prof'].get('surface.update', [0, 0]) for d in ds if d.get('prof')]
        oth = {}
        for d in ds:
            for n, v in (d.get('prof') or {}).items():
                if n != 'surface.update': oth[n] = oth.get(n, 0) + v[0] / len(ds)
        print(f"{lab:<16}{k:<6}{len(ds):>3}{st.median([d['first_ms'] or 0 for d in ds]):>7.1f}{q(.5):>6.1f}{q(.95):>6.1f}{max(s or [0]):>6.1f}{sum(x>12.5 for x in acc):>6}{st.median([u[1] for u in upd]) if upd else 0:>8.1f}{st.median([u[0] for u in upd]) if upd else 0:>6}  " + ', '.join(f"{n} {v:.0f}" for n, v in sorted(oth.items())))
