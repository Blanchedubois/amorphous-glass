// gjs -m tools/widgets-stress/schedule-test.js: what the Schedule widgets say
// (extensions/tahoe-widgets@cachyos-tahoe/schedule-model.js) for one made-up day, Tuesday
// 20 October 2026 in New York, at the times that matter: before and while events, at their
// starts and ends, the relative time, multi-day events, midnight. Expected lines worked out by hand.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const ZONE = 'America/New_York';
const self = GLib.filename_from_uri(import.meta.url)[0];
if (GLib.getenv('TZ') !== ZONE) {   // the local zone is read at start: run again in New York
    const l = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    l.setenv('TZ', ZONE, true);
    const p = l.spawnv(['gjs', '-m', self]);
    p.wait(null);
    System.exit(p.get_exit_status());
}
const M = await import(`file://${GLib.path_get_dirname(self)}/../../extensions/tahoe-widgets@cachyos-tahoe/schedule-model.js`);

const at = (s, sec = 0) => {
    const [d, t] = s.split(' ');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return GLib.DateTime.new_local(y, mo, da, h, mi, sec);
};
const unix = s => at(s).to_unix();
const timed = (uid, title, s, e) => ({uid, title, allDay: false, start: unix(s), end: unix(e)});
// sorted by start, as ics-expand.js prints them
const EVENTS = [
    timed('trip', 'Trip', '2026-10-19 08:00', '2026-10-22 18:00'),
    timed('overnight', 'Overnight', '2026-10-19 22:00', '2026-10-20 02:00'),
    {uid: 'holiday', title: 'Holiday', allDay: true, start: unix('2026-10-20 00:00'), end: unix('2026-10-21 00:00'),
        startDate: '2026-10-20', endDate: '2026-10-21'},
    timed('standup', 'Standup', '2026-10-20 09:30', '2026-10-20 09:45'),
    {...timed('gym', 'Gym', '2026-10-20 10:30', '2026-10-20 11:45'), color: '#0a84ff'},
    timed('lunch', 'Lunch', '2026-10-20 13:15', '2026-10-20 14:15'),
    timed('conf', 'Conference', '2026-10-20 15:00', '2026-10-23 12:00'),
    timed('reminder', 'Reminder', '2026-10-20 16:00', '2026-10-20 16:00'),
    timed('late', 'Late show', '2026-10-20 23:00', '2026-10-21 01:00'),
    timed('tomorrow', 'Tomorrow', '2026-10-21 09:00', '2026-10-21 10:00'),
];

// title | small time line | large time line (relative time after " / ")
const C = [
    ['00:30 (overnight going on, nothing within 6 h)', '2026-10-20 00:30', 0, false, [
        'Trip +1|All day|All day', 'Overnight|Now · until 2:00 AM|Now · until 2:00 AM', 'Standup|9:30 AM|9:30 – 9:45 AM',
        'Gym|10:30 AM|10:30 – 11:45 AM', 'Lunch|1:15 PM|1:15 – 2:15 PM', 'Conference|3:00 PM|From 3:00 PM',
        'Reminder|4:00 PM|4:00 PM', 'Late show|11:00 PM|From 11:00 PM']],
    ['09:21:30 (next in 8.5 min: "in 9 min")', '2026-10-20 09:21', 30, false, [
        'Trip +1|All day|All day', 'Standup|9:30 AM / in 9 min|9:30 – 9:45 AM / in 9 min', 'Gym|10:30 AM|10:30 – 11:45 AM',
        'Lunch|1:15 PM|1:15 – 2:15 PM', 'Conference|3:00 PM|From 3:00 PM', 'Reminder|4:00 PM|4:00 PM', 'Late show|11:00 PM|From 11:00 PM']],
    ['09:30 exactly (now; the next one in an hour)', '2026-10-20 09:30', 0, false, [
        'Trip +1|All day|All day', 'Standup|Now · until 9:45 AM|Now · until 9:45 AM', 'Gym|10:30 AM / in 1 h|10:30 – 11:45 AM / in 1 h',
        'Lunch|1:15 PM|1:15 – 2:15 PM', 'Conference|3:00 PM|From 3:00 PM', 'Reminder|4:00 PM|4:00 PM', 'Late show|11:00 PM|From 11:00 PM']],
    ['09:45 exactly (ended at its end)', '2026-10-20 09:45', 0, false, [
        'Trip +1|All day|All day', 'Gym|10:30 AM / in 45 min|10:30 – 11:45 AM / in 45 min', 'Lunch|1:15 PM|1:15 – 2:15 PM',
        'Conference|3:00 PM|From 3:00 PM', 'Reminder|4:00 PM|4:00 PM', 'Late show|11:00 PM|From 11:00 PM']],
    ['11:00 (2 h 15 min: "in 2 h")', '2026-10-20 11:00', 0, false, [
        'Trip +1|All day|All day', 'Gym|Now · until 11:45 AM|Now · until 11:45 AM', 'Lunch|1:15 PM / in 2 h|1:15 – 2:15 PM / in 2 h',
        'Conference|3:00 PM|From 3:00 PM', 'Reminder|4:00 PM|4:00 PM', 'Late show|11:00 PM|From 11:00 PM']],
    ['16:00 (a zero-length reminder goes at its time; an event ending Friday)', '2026-10-20 16:00', 0, false, [
        'Trip +1|All day|All day', 'Conference|Now · until Fri|Now · until Fri', 'Late show|11:00 PM|From 11:00 PM']],
    ['23:30 (an event ending after midnight)', '2026-10-20 23:30', 0, false, [
        'Trip +1|All day|All day', 'Conference|Now · until Fri|Now · until Fri', 'Late show|Now · until 1:00 AM|Now · until 1:00 AM']],
    ['00:00:30 the next day (rollover: multi-day events become all-day)', '2026-10-21 00:00', 30, false, [
        'Trip +1|All day|All day', 'Late show|Now · until 1:00 AM|Now · until 1:00 AM', 'Tomorrow|9:00 AM|9:00 – 10:00 AM']],
    ['24-hour clock', '2026-10-20 09:21', 30, true, [
        'Trip +1|All day|All day', 'Standup|09:30 / in 9 min|09:30 – 09:45 / in 9 min', 'Gym|10:30|10:30 – 11:45',
        'Lunch|13:15|13:15 – 14:15', 'Conference|15:00|From 15:00', 'Reminder|16:00|16:00', 'Late show|23:00|From 23:00']],
];

let failed = 0;
const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) {
        failed++;
        print(`  want: ${JSON.stringify(want, null, 1)}\n  got:  ${JSON.stringify(got, null, 1)}`);
    }
};
const fmt = ([text, rel]) => rel ? `${text} / ${rel}` : text;

for (const [name, when, sec, h24, want] of C) {
    const now = at(when, sec);
    const rows = M.schedule(EVENTS, now);
    check(name, rows.map(r => [r.title, fmt(M.timeLine(r, now, {h24, large: false})), fmt(M.timeLine(r, now, {h24, large: true}))].join('|')), want);
}

const day = M.schedule(EVENTS, at('2026-10-20 09:00'));
check('colours: the event\'s own, else a fixed one per UID', [day.find(r => r.uid === 'gym').color, day.find(r => r.uid === 'lunch').color === M.paletteColor('lunch'),
    M.paletteColor('lunch') === M.paletteColor('lunch')], ['#0a84ff', true, true]);
check('"now" colour: the event\'s on dark and milky, the text colour on light',
    [M.nowColor('#0a84ff', 'light'), M.nowColor('#0a84ff', 'dark'), M.nowColor('turquoise', 'milky')], [null, '#0a84ff', 'turquoise']);
check('relative times', [1, 59 * 60, 60 * 60, 89 * 60, 90 * 60, 359 * 60, 360 * 60].map(M.relative),
    ['in 1 min', 'in 59 min', 'in 1 h', 'in 1 h', 'in 2 h', 'in 6 h', '']);
check('a range across noon', M.range(unix('2026-10-20 10:30'), unix('2026-10-20 12:45'), false), '10:30 AM – 12:45 PM');
check('updated today, and yesterday', [M.updatedAt(unix('2026-10-20 21:41'), at('2026-10-20 23:30'), false),
    M.updatedAt(unix('2026-10-20 21:41'), at('2026-10-21 08:00'), false), M.updatedAt(0, at('2026-10-21 08:00'), false)],
['9:41 PM', 'Tue 9:41 PM', '']);
const busy = first => M.week(EVENTS, at('2026-10-20 12:00'), first).map(d => `${d.date.format('%a')}${d.today ? '*' : ''}${d.busy ? '.' : ''}${d.weekend ? 'w' : ''}`);
check('week from Sunday: today circled, dots on busy days', busy(0), ['Sunw', 'Mon.', 'Tue*', 'Wed.', 'Thu.', 'Fri.', 'Satw']);
check('week from Monday', busy(1), ['Mon.', 'Tue*', 'Wed.', 'Thu.', 'Fri.', 'Satw', 'Sunw']);
check('no events: no rows', M.schedule([], at('2026-10-20 12:00')), []);

print(failed ? `${failed} failed` : 'all ok');
System.exit(failed ? 1 : 0);
