// What the Schedule widgets say, from the feed's occurrences and the time: no actors, no shell,
// only GLib, so tools/widgets-stress/schedule-test.js can check it outside the shell.

import GLib from 'gi://GLib';

// Apple's system colours (dark variants), picked by the event's UID so a series keeps its colour;
// the event's or the calendar's own colour comes first
const PALETTE = ['#ff9f0a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#40c8e0', '#ffd60a', '#5e5ce6'];

export function paletteColor(uid) {
    let h = 0x811c9dc5;   // FNV-1a
    for (let i = 0; i < uid.length; i++)
        h = Math.imul(h ^ uid.charCodeAt(i), 0x01000193) >>> 0;
    return PALETTE[h % PALETTE.length];
}

// "Now" in the event's colour on dark and milky glass; on light glass, where a deeper shade of
// orange or yellow still reads poorly on a bright wallpaper, null: the full text colour (the bar
// keeps the colour)
export function nowColor(color, mode) {
    return mode === 'light' ? null : color;
}

const local = t => GLib.DateTime.new_from_unix_local(t);
export const midnight = d => GLib.DateTime.new_local(d.get_year(), d.get_month(), d.get_day_of_month(), 0, 0, 0);

export function clock(t, h24, {suffix = true} = {}) {
    const d = local(t);
    if (h24)
        return d.format('%H:%M');
    return (suffix ? d.format('%l:%M %p') : d.format('%l:%M')).trim();
}

// 10:30 – 11:45 AM, 10:30 AM – 12:45 PM, 10:30 – 11:45
export function range(start, end, h24) {
    if (end <= start)
        return clock(start, h24);
    if (h24)
        return `${clock(start, h24)} – ${clock(end, h24)}`;
    const same = local(start).format('%p') === local(end).format('%p');
    return `${clock(start, h24, {suffix: !same})} – ${clock(end, h24)}`;
}

// in 8 min, in 2 h (rounded); nothing from 6 h
export function relative(seconds) {
    const min = Math.max(1, Math.ceil(seconds / 60));
    if (min < 60)
        return `in ${min} min`;
    return min < 6 * 60 ? `in ${Math.round(min / 60)} h` : '';
}

// the rows for the local day of `nowDate`, in order: one row for the all-day events (and timed
// ones covering the whole day), then what has not ended yet. The first one not yet started gets
// the relative time; the ones going on are "now".
export function schedule(events, nowDate) {
    const now = nowDate.to_unix();
    const day0 = midnight(nowDate);
    const dayStart = day0.to_unix();
    const dayEnd = day0.add_days(1).to_unix();
    const today = nowDate.format('%Y-%m-%d');
    const allDay = [];
    const timed = [];
    for (const e of events) {
        if (e.allDay) {
            if (e.startDate <= today && e.endDate > today)
                allDay.push(e);
        } else if (e.start <= dayStart && e.end >= dayEnd) {
            allDay.push(e);   // a timed event over the whole day (a trip)
        } else if (e.end > e.start ? e.end > Math.max(now, dayStart) && e.start < dayEnd
            : e.start > now && e.start < dayEnd) {
            timed.push(e);
        }
    }
    const rows = [];
    if (allDay.length) {
        const first = allDay[0];
        rows.push({kind: 'allday', uid: first.uid, color: first.color ?? paletteColor(first.uid),
            title: first.title + (allDay.length > 1 ? ` +${allDay.length - 1}` : '')});
    }
    let nextMarked = false;
    for (const e of timed) {
        const row = {kind: 'timed', uid: e.uid, title: e.title, color: e.color ?? paletteColor(e.uid),
            start: e.start, end: e.end, fromBefore: e.start < dayStart, pastToday: e.end > dayEnd};
        if (e.start <= now && now < e.end) {
            row.now = true;
        } else if (!nextMarked) {
            row.rel = relative(e.start - now);
            nextMarked = true;
        }
        rows.push(row);
    }
    return rows;
}

// the time line of a row: [plain text, italic relative time or '']
//   large: ranges; small: start times only (a range and "in 8 min" do not fit in 134 px)
export function timeLine(row, nowDate, {h24, large}) {
    if (row.kind === 'allday')
        return ['All day', ''];
    if (row.now) {
        // until 11:45 AM today or tomorrow morning; a later end by its weekday
        const endDay = midnight(local(row.end)).to_unix();
        const later = endDay > midnight(nowDate).add_days(1).to_unix();
        return [`Now · until ${later ? local(row.end).format('%a') : clock(row.end, h24)}`, ''];
    }
    let when;
    if (!large)
        when = clock(row.start, h24);
    else if (row.pastToday)
        when = `From ${clock(row.start, h24)}`;
    else
        when = range(row.start, row.end, h24);
    return [when, row.rel ?? ''];
}

// when the feed last answered: 9:41 PM today, else Mon 9:41 PM
export function updatedAt(updated, nowDate, h24) {
    if (!updated)
        return '';
    const d = local(updated);
    const sameDay = d.format('%Y-%m-%d') === nowDate.format('%Y-%m-%d');
    return sameDay ? clock(updated, h24) : `${d.format('%a')} ${clock(updated, h24)}`;
}

// the days of the week holding nowDate, from firstWeekday (0 = Sunday), with whether each has
// events; today is marked apart (the red circle), so it gets no dot
export function week(events, nowDate, firstWeekday) {
    const start = midnight(nowDate).add_days(-(((nowDate.get_day_of_week() % 7) - firstWeekday + 7) % 7));
    const today = nowDate.format('%Y-%m-%d');
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = start.add_days(i);
        const key = d.format('%Y-%m-%d');
        const from = d.to_unix(), to = d.add_days(1).to_unix();
        const busy = events.some(e => e.allDay ? e.startDate <= key && e.endDate > key
            : e.end > e.start ? e.end > from && e.start < to : e.start >= from && e.start < to);
        days.push({date: d, today: key === today, weekend: [0, 6].includes(d.get_day_of_week() % 7), busy: busy && key !== today});
    }
    return days;
}
