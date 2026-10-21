#!/usr/bin/env python3
# ics-bigfeed.py OUT.ics [MB]: a made-up feed the size of an old Google calendar (default 5 MB):
# years of single events, weekly and daily series since 2012 to 2024 with EXDATEs and overrides,
# all in one VTIMEZONE. For timing ics-expand.js; nothing in it is real.
import random, sys
from datetime import datetime, timedelta
out, mb = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 5
r = random.Random(7)
tz = open(__file__.replace('ics-bigfeed.py', 'ics/recur.ics')).read()
tz = tz[tz.index('BEGIN:VTIMEZONE'):tz.index('END:VTIMEZONE') + 13]
words = 'review planning lunch call gym dentist sync design budget offsite school pickup train flight demo'.split()
f = lambda d: d.strftime('%Y%m%dT%H%M%S')
lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tahoe-widgets//big fixture//EN', tz]
size, n = 0, 0
while size < mb * 1024 * 1024:
    n += 1
    start = datetime(2012, 1, 1) + timedelta(days=r.randrange(0, 15 * 365), minutes=15 * r.randrange(28, 80))
    ev = ['BEGIN:VEVENT', f'UID:big-{n}@fixture.test', 'DTSTAMP:20260101T000000Z',
          f'DTSTART;TZID=America/New_York:{f(start)}', f'DTEND;TZID=America/New_York:{f(start + timedelta(minutes=30 * r.randrange(1, 5)))}',
          f'SUMMARY:{r.choice(words).title()} {r.choice(words)} {n}',
          'DESCRIPTION:' + ' '.join(r.choice(words) for _ in range(r.randrange(5, 60)))]
    kind = r.random()
    if kind < 0.06:
        ev.append('RRULE:FREQ=WEEKLY;BYDAY=' + r.choice(['MO', 'TU,TH', 'WE', 'MO,WE,FR']))
        ev += [f'EXDATE;TZID=America/New_York:{f(start + timedelta(weeks=r.randrange(1, 300)))}' for _ in range(r.randrange(0, 6))]
    elif kind < 0.07:
        ev.append('RRULE:FREQ=DAILY')
    elif kind < 0.09:
        ev.append(f'RRULE:FREQ=MONTHLY;BYDAY={r.randrange(1, 4)}TU;COUNT={r.randrange(5, 60)}')
    ev.append('END:VEVENT')
    block = '\r\n'.join(ev)
    size += len(block)
    lines.append(block)
lines.append('END:VCALENDAR')
open(out, 'w').write('\r\n'.join(lines) + '\r\n')
print(n, 'events,', round(size / 1048576, 1), 'MB')
