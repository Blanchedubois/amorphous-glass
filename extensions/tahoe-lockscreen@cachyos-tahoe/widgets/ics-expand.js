// ics-expand.js: the Schedule widgets' ICS reader, run as its own process
// (gjs -m ics-expand.js FILE --from YYYY-MM-DD --to YYYY-MM-DD), never inside the shell: a real
// feed holds every event since the calendar began, and parsing it would stall the shell.
//
// Prints every occurrence that overlaps the local days [from, to) as JSON on stdout:
//   {version, tz, from, to, events: [{uid, title, allDay, start, end, startDate?, endDate?, color?}]}
// start and end are unix seconds (all-day: local midnight; end is exclusive); all-day events also
// carry their dates. Recurrences with RRULE, RDATE, EXDATE and RECURRENCE-ID overrides (ical.js),
// cancelled events and occurrences dropped. Only the title is read: no description, place or
// people. Exit 2 (nothing on stdout) when the file is not a calendar.

import GLib from 'gi://GLib';
import System from 'system';
import ICAL from './vendor/ical.js';

const MAX_STEPS = 50000;   // occurrences walked per series (a daily event since 1890)
const MAX_TITLE = 200;

function fail(why) {
    printerr(`ics-expand: ${why}`);
    System.exit(2);
}

function args() {
    const out = {file: null, from: null, to: null};
    for (let i = 0; i < ARGV.length; i++) {
        if (ARGV[i] === '--from' || ARGV[i] === '--to')
            out[ARGV[i].slice(2)] = ARGV[++i];
        else
            out.file = ARGV[i];
    }
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (!out.file || !date.test(out.from ?? '') || !date.test(out.to ?? ''))
        fail('usage: ics-expand.js FILE --from YYYY-MM-DD --to YYYY-MM-DD');
    return out;
}

// RFC 5545 folds lines at 75 octets, possibly inside a UTF-8 character: unfold the bytes first
function unfold(bytes) {
    const out = new Uint8Array(bytes.length);
    let n = 0;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 13 && bytes[i + 1] === 10 && (bytes[i + 2] === 32 || bytes[i + 2] === 9)) {
            i += 2;
            continue;
        }
        if (b === 10 && (bytes[i + 1] === 32 || bytes[i + 1] === 9)) {
            i += 1;
            continue;
        }
        out[n++] = b;
    }
    return new TextDecoder().decode(out.subarray(0, n)).replace(/^﻿/, '');
}

const localZone = GLib.TimeZone.new_local();
const zones = new Map();
function glibZone(tzid) {
    if (!tzid)
        return localZone;
    if (!zones.has(tzid))
        zones.set(tzid, GLib.TimeZone.new_identifier(tzid) ?? localZone);
    return zones.get(tzid);
}

const midnight = (y, m, d) => GLib.DateTime.new(localZone, y, m, d, 0, 0, 0).to_unix();
const dateString = t => `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

// unix seconds of an ICAL.Time. ical.js knows UTC and the zones the feed defines (VTIMEZONE);
// a TZID with no VTIMEZONE comes back floating, so it goes through the system's tz database by
// name, and a floating time is local.
function unix(time, tzid) {
    if (time.isDate)
        return midnight(time.year, time.month, time.day);
    if (time.zone && time.zone !== ICAL.Timezone.localTimezone && time.zone.tzid !== 'floating')
        return time.toUnixTime();
    return GLib.DateTime.new(glibZone(tzid), time.year, time.month, time.day, time.hour, time.minute, time.second).to_unix();
}

// overrides are handled here; without this, every ICAL.Event looks through every VEVENT in the
// calendar for its own (quadratic: 16 s for a 5 MB feed)
const NO_EXCEPTIONS = {exceptions: []};
const DAY_MS = 86400000;
const dayNumber = t => Date.UTC(t.year, t.month - 1, t.day) / DAY_MS;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// A long-running series walked from its first occurrence costs a step per occurrence (a daily
// event since 2012 is 5000). For the common simple ones (DAILY, or WEEKLY by weekday only, with
// no COUNT) this is a copy that starts a whole number of periods later, just before firstDay: in
// wall-clock time and on the same weekday, so every later occurrence is the same. (The new DTSTART
// is always an occurrence, as RFC 5545 says, even off the BYDAY days; it is before firstDay, so
// the walk drops it.)
// EXDATE and RDATE before the new start go too (ical.js walks them in step with the series).
function nearWindow(master, event, firstDay) {
    const rules = master.getAllProperties('rrule');
    if (rules.length !== 1 || master.hasProperty('exrule'))
        return null;
    const rule = rules[0].getFirstValue();
    if (rule.count || !['DAILY', 'WEEKLY'].includes(rule.freq))
        return null;
    const parts = Object.keys(rule.parts ?? {});
    if (parts.some(p => !(rule.freq === 'WEEKLY' && p === 'BYDAY')))
        return null;
    const start = event.startDate;
    if (rule.parts?.BYDAY && !rule.parts.BYDAY.every(d => WEEKDAYS.includes(d)))
        return null;
    const period = (rule.interval || 1) * (rule.freq === 'DAILY' ? 1 : 7);
    const shift = Math.floor((firstDay - 1 - dayNumber(start)) / period) * period;
    if (shift <= 0)
        return null;
    const copy = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())));
    for (const name of ['dtstart', 'dtend']) {
        const prop = copy.getFirstProperty(name);
        if (prop) {
            const t = prop.getFirstValue();
            t.adjust(shift, 0, 0, 0);
            prop.setValue(t);
        }
    }
    const newStart = dayNumber(start) + shift;
    for (const name of ['exdate', 'rdate']) {
        for (const prop of copy.getAllProperties(name)) {
            const keep = prop.getValues().filter(v => !v.year || dayNumber(v) >= newStart);
            if (keep.length)
                prop.setValues(keep);
            else
                copy.removeProperty(prop);
        }
    }
    return new ICAL.Event(copy, NO_EXCEPTIONS);
}

const tzidOf = (component, name) => component.getFirstProperty(name)?.getParameter('tzid') ?? null;

function cleanText(s) {
    // eslint-disable-next-line no-control-regex
    return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_TITLE);
}

// RFC 7986 COLOR is a CSS colour name; Apple and Outlook use #RRGGBB(AA)
function cleanColor(s) {
    if (typeof s !== 'string')
        return null;
    s = s.trim().toLowerCase();
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s))
        return s.slice(0, 7);
    return /^[a-z]{3,20}$/.test(s) ? s : null;
}

function main() {
    const {file, from, to} = args();
    let text;
    try {
        text = unfold(GLib.file_get_contents(file)[1]);
    } catch (e) {
        fail(`cannot read the file (${e.code ?? e.message})`);
    }
    if (!/^\s*BEGIN:VCALENDAR/i.test(text))
        fail('not a calendar');
    let calendar;
    try {
        calendar = new ICAL.Component(ICAL.parse(text));
    } catch (e) {
        fail(`parse error (${e.name})`);
    }
    if (calendar.name !== 'vcalendar')
        fail('not a calendar');

    for (const tz of calendar.getAllSubcomponents('vtimezone')) {
        try {
            ICAL.TimezoneService.register(tz);
        } catch {}   // a broken VTIMEZONE: its TZID falls back to the tz database
    }
    const calendarColor = cleanColor(calendar.getFirstPropertyValue('color') ??
        calendar.getFirstPropertyValue('x-apple-calendar-color') ?? calendar.getFirstPropertyValue('x-outlook-color'));

    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromUnix = midnight(fy, fm, fd);
    const toUnix = midnight(ty, tm, td);

    // every VEVENT by UID: the series (no RECURRENCE-ID) and its overrides
    const byUid = new Map();
    for (const v of calendar.getAllSubcomponents('vevent')) {
        const uid = String(v.getFirstPropertyValue('uid') ?? `no-uid-${byUid.size}`);
        if (!byUid.has(uid))
            byUid.set(uid, {master: null, overrides: []});
        const group = byUid.get(uid);
        if (v.hasProperty('recurrence-id'))
            group.overrides.push(v);
        else if (!group.master)
            group.master = v;
    }

    const fromDay = dayNumber({year: fy, month: fm, day: fd});
    const toDay = dayNumber({year: ty, month: tm, day: td});
    const events = [];
    // one occurrence of item from start to end (ICAL.Time); tzids for times ical.js left floating
    const add = (uid, item, start, end, startTzid, endTzid) => {
        const component = item.component;
        if (String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED')
            return;
        const allDay = start.isDate;
        const s = unix(start, startTzid);
        let e = end ? unix(end, endTzid) : s;
        if (allDay && e <= s) {   // no DTEND: one day
            end = start.clone();
            end.adjust(1, 0, 0, 0);
            e = unix(end);
        }
        const inside = e > s ? e > fromUnix && s < toUnix : s >= fromUnix && s < toUnix;
        if (!inside)
            return;
        const event = {uid, title: cleanText(item.summary) || 'Event', allDay, start: s, end: Math.max(e, s)};
        if (allDay) {
            event.startDate = dateString(start);
            event.endDate = dateString(end);
        }
        const color = cleanColor(component.getFirstPropertyValue('color')) ?? calendarColor;
        if (color)
            event.color = color;
        events.push(event);
    };
    const single = (uid, component) => {
        const e = new ICAL.Event(component, NO_EXCEPTIONS);
        add(uid, e, e.startDate, e.endDate, tzidOf(component, 'dtstart'),
            tzidOf(component, 'dtend') ?? tzidOf(component, 'dtstart'));
    };

    for (const [uid, {master, overrides}] of byUid) {
        try {
            // an override replaces one occurrence: it shows on its own (moved, retitled or
            // cancelled), and the series skips the occurrence it replaces
            for (const o of overrides)
                single(uid, o);
            if (!master)
                continue;
            const event = new ICAL.Event(master, NO_EXCEPTIONS);
            if (String(master.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED')
                continue;
            if (!event.isRecurring()) {
                single(uid, master);
                continue;
            }
            const tzid = tzidOf(master, 'dtstart');
            const replaced = new Set(overrides.map(o => unix(o.getFirstPropertyValue('recurrence-id'), tzidOf(o, 'recurrence-id'))));
            const duration = event.duration;
            const days = Math.ceil(Math.max(0, duration.toSeconds()) / 86400);
            // occurrences that start before this day cannot reach the window (zones differ by 26 h at most)
            const firstDay = fromDay - 2 - days;
            const series = nearWindow(master, event, firstDay) ?? event;
            const it = series.iterator();
            for (let steps = 0, next; (next = it.next()) && steps < MAX_STEPS; steps++) {
                const day = dayNumber(next);
                if (day > toDay + 2)
                    break;
                if (day < firstDay)
                    continue;
                const start = unix(next, tzid);
                if (start >= toUnix)
                    break;
                if (replaced.has(start))
                    continue;
                const end = next.clone();
                end.addDuration(duration);
                add(uid, event, next, end, tzid, tzid);
            }
        } catch (e) {
            printerr(`ics-expand: skipped an event (${e.name}: ${e.message})`);
        }
    }

    events.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) ||
        a.title.localeCompare(b.title) || a.uid.localeCompare(b.uid));
    print(JSON.stringify({version: 1, tz: localZone.get_identifier(), from, to, events}));
}

main();
