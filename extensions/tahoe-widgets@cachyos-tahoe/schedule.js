// Schedule widgets: what is left of today from a calendar's private ICS link (icsfeed.js).
// Small (170 x 170): the weekday and day, then up to 3 rows. Large (356 x 356): the day, the
// week with today circled and a dot under days with events, then up to 4 rows with time ranges.
// Desktop only: the lock screen does not carry this file.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {acquireFeed, Status} from './icsfeed.js';
import {use24h} from './clocks.js';

// Apple's system colours (dark variants: they read on every glass mode), picked by the event's
// UID so a series keeps its colour; the event's or calendar's own colour comes first
const PALETTE = ['#ff9f0a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#40c8e0', '#ffd60a', '#5e5ce6'];

function paletteColor(uid) {
    let h = 0x811c9dc5;   // FNV-1a
    for (let i = 0; i < uid.length; i++)
        h = Math.imul(h ^ uid.charCodeAt(i), 0x01000193) >>> 0;
    return PALETTE[h % PALETTE.length];
}

const esc = s => GLib.markup_escape_text(s, -1);

// the first day of the week: GNOME's setting, else the locale's (as calendar.js)
function weekStart() {
    try {
        const day = new Gio.Settings({schema_id: 'org.gnome.desktop.calendar'}).get_enum('week-start-day');
        if (day !== 0)
            return day % 7;
    } catch {}
    return Shell.util_get_week_start();
}

const local = t => GLib.DateTime.new_from_unix_local(t);
const midnight = d => GLib.DateTime.new_local(d.get_year(), d.get_month(), d.get_day_of_month(), 0, 0, 0);

function clock(t, {suffix = true} = {}) {
    const d = local(t);
    if (use24h())
        return d.format('%H:%M');
    return (suffix ? d.format('%l:%M %p') : d.format('%l:%M')).trim();
}

// 10:30 – 11:45 AM, 10:30 AM – 12:45 PM, 10:30 – 11:45
function range(start, end) {
    if (use24h() || end <= start)
        return end > start ? `${clock(start)} – ${clock(end)}` : clock(start);
    const same = local(start).format('%p') === local(end).format('%p');
    return `${clock(start, {suffix: !same})} – ${clock(end)}`;
}

// in 8 min, in 2 h; nothing past 6 h
function relative(seconds) {
    const min = Math.max(1, Math.ceil(seconds / 60));
    if (min < 60)
        return `in ${min} min`;
    return min < 6 * 60 ? `in ${Math.floor(min / 60)} h` : '';
}

// what the rows show for the local day of `now`; pure, so the minute tick is cheap
export function schedule(events, nowDate) {
    const now = Math.floor(nowDate.to_unix());
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
        } else if (e.end > e.start ? e.end > Math.max(now, dayStart) && e.start < dayEnd : e.start >= now && e.start < dayEnd) {
            timed.push(e);
        }
    }
    const rows = [];
    if (allDay.length) {
        rows.push({kind: 'allday', uid: allDay[0].uid, color: allDay[0].color ?? paletteColor(allDay[0].uid),
            title: allDay[0].title + (allDay.length > 1 ? ` +${allDay.length - 1}` : '')});
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

class ScheduleWidget {
    static size = 'small';

    constructor() {
        this._feed = acquireFeed();
        this._now = null;
        this._key = null;
        this._version = 0;   // of the events, for the header's dots
        this._feed.connectObject('events-changed', () => {
            this._version++;
            this._refresh();
        }, 'status-changed', () => this._refresh(), this);

        this.actor = new St.BoxLayout({
            style_class: `tahoe-sched ${this.constructor.styleClass}`,
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._build();
        this._rows = new St.BoxLayout({
            style_class: 'tahoe-sched-rows',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this.actor.add_child(this._rows);
    }

    setMode() {}

    get wantsSeconds() {
        return false;
    }

    tick(now) {
        this._now = now;
        this._feed.ensureWindow(now);
        this._refresh();
    }

    _refresh() {
        const now = this._now ?? GLib.DateTime.new_now_local();
        const rows = schedule(this._feed.events, now);
        const state = this._state(rows);
        // actors change only when what they say changes: the header once a day (and with new
        // events), the rows when a row's text does ("in 8 min" under the hour, past events going)
        const headerKey = `${now.format('%Y-%m-%d')} ${this._version}`;
        if (headerKey !== this._headerKey) {
            this._headerKey = headerKey;
            this._header(now);
        }
        const key = JSON.stringify([use24h(), state, rows.map(r => [r.title, r.color, this._timeMarkup(r), r.now])]);
        if (key === this._key)
            return;
        this._key = key;
        this._fill(rows, state, now);
    }

    // what to say instead of (or under) the events
    _state(rows) {
        const feed = this._feed;
        const since = feed.updated ? ` · ${clock(feed.updated)}` : '';
        switch (feed.status) {
        case Status.NONE:
            return {empty: ['No calendar link', 'tahoe-widgets.sh calendar-url']};
        case Status.LOCKED:
            return feed.events.length ? {footer: 'Calendar locked'} : {empty: ['Calendar locked', 'Unlock to show events']};
        case Status.INVALID:
            return feed.events.length ? {footer: 'Calendar link not valid'} : {empty: ['Calendar link not valid', 'Set it again: tahoe-widgets.sh calendar-url']};
        case Status.OFFLINE:
            return feed.events.length ? {footer: `Can't reach calendar${since}`} : {empty: ["Can't reach calendar", 'Will retry']};
        case Status.LOADING:
            if (!feed.events.length)
                return {empty: ['Loading calendar…', '']};
        }
        return rows.length ? {} : {empty: ['No more events today', '']};
    }

    _fill(rows, state, now) {
        this._rows.destroy_all_children();
        if (state.empty) {
            this._emptyState(...state.empty);
            return;
        }
        // the small widget's footer takes the last row's place
        const cap = this.constructor.maxRows;
        const footer = Boolean(state.footer) || rows.length > cap;
        const fit = footer && this.constructor.footerTakesRow ? cap - 1 : cap;
        for (const row of rows.slice(0, fit))
            this._rows.add_child(this._row(row, now));
        const text = state.footer ?? (rows.length > fit ? `+${rows.length - fit} more` : null);
        if (text) {
            this._rows.add_child(new St.Widget({y_expand: true}));
            this._rows.add_child(new St.Label({style_class: 'tahoe-widget-secondary tahoe-sched-footer', text}));
        }
    }

    _emptyState(title, detail) {
        const box = new St.BoxLayout({
            style_class: 'tahoe-sched-empty',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            y_align: this.constructor.emptyAlign,
        });
        const t = new St.Label({style_class: 'tahoe-sched-empty-title', text: title});
        t.clutter_text.line_wrap = true;
        box.add_child(t);
        if (detail) {
            const d = new St.Label({style_class: 'tahoe-widget-secondary tahoe-sched-empty-detail', text: detail});
            d.clutter_text.line_wrap = true;
            box.add_child(d);
        }
        this._rows.add_child(box);
    }

    // one event: a bar in its colour, the time line over the title
    _row(row, now) {
        const box = new St.BoxLayout({style_class: 'tahoe-sched-row', x_expand: true});
        // fills the row's height without y_expand (which would spread to the row and stretch it)
        box.add_child(new St.Widget({style_class: 'tahoe-sched-bar', style: `background-color: ${row.color};`}));
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const time = new St.Label({style_class: 'tahoe-widget-secondary tahoe-sched-time'});
        time.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
        if (row.now) {
            time.add_style_class_name('tahoe-sched-time-now');
            time.style = `color: ${row.color};`;
        }
        time.clutter_text.set_markup(this._timeMarkup(row));
        const title = new St.Label({style_class: 'tahoe-sched-title', text: row.title});
        title.clutter_text.ellipsize = 3;
        text.add_child(time);
        text.add_child(title);
        box.add_child(text);
        return box;
    }

    _timeMarkup(row) {
        if (row.kind === 'allday')
            return 'All day';
        if (row.now)
            return esc(row.pastToday ? 'Now · until tomorrow' : `Now · until ${clock(row.end)}`);
        let when = this._when(row);
        if (row.rel)
            when = `${esc(when)}  <i>${esc(row.rel)}</i>`;
        else
            when = esc(when);
        return when;
    }

    destroy() {
        this._feed.disconnectObject(this);
        this._feed.release();
        this._feed = null;
        this.actor.destroy();
    }
}

export class ScheduleSmall extends ScheduleWidget {
    static size = 'small';
    static styleClass = 'tahoe-sched-small';
    static maxRows = 3;
    static footerTakesRow = true;
    static emptyAlign = Clutter.ActorAlign.END;

    _build() {
        const header = new St.BoxLayout({style_class: 'tahoe-sched-header'});
        this._weekday = new St.Label({style_class: 'tahoe-widget-accent'});
        this._day = new St.Label({style_class: 'tahoe-sched-header-day'});
        header.add_child(this._weekday);
        header.add_child(this._day);
        this.actor.add_child(header);
    }

    _header(now) {
        this._weekday.text = now.format('%A').toUpperCase();
        this._day.text = String(now.get_day_of_month());
    }

    // start times only: a range and "in 8 min" do not fit in 134 px
    _when(row) {
        if (row.fromBefore)
            return `Until ${clock(row.end)}`;
        return clock(row.start);
    }
}

export class ScheduleLarge extends ScheduleWidget {
    static size = 'large';
    static styleClass = 'tahoe-sched-large';
    static maxRows = 4;
    static footerTakesRow = false;
    static emptyAlign = Clutter.ActorAlign.CENTER;

    _build() {
        const header = new St.BoxLayout({style_class: 'tahoe-sched-header'});
        this._dayNum = new St.Label({style_class: 'tahoe-sched-daynum', y_align: Clutter.ActorAlign.CENTER});
        const names = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        this._month = new St.Label({style_class: 'tahoe-sched-month'});
        this._today = new St.Label({style_class: 'tahoe-widget-secondary tahoe-sched-today'});
        names.add_child(this._month);
        names.add_child(this._today);
        header.add_child(this._dayNum);
        header.add_child(names);
        this.actor.add_child(header);

        this._week = new St.Widget({
            style_class: 'tahoe-sched-week',
            layout_manager: new Clutter.GridLayout({column_homogeneous: true, row_spacing: 3}),
            x_expand: true,
        });
        this.actor.add_child(this._week);
        this.actor.add_child(new St.Widget({style_class: 'tahoe-sched-separator', x_expand: true}));
    }

    _header(now) {
        this._dayNum.text = String(now.get_day_of_month());
        this._month.text = now.format('%B');
        this._today.text = `Today, ${now.format('%A')}`;

        // this week from GNOME's first weekday; a dot under the other days that have events
        this._week.destroy_all_children();
        const grid = this._week.layout_manager;
        const start = midnight(now).add_days(-(((now.get_day_of_week() % 7) - weekStart() + 7) % 7));
        const busy = new Set();
        for (const e of this._feed.events) {
            for (let i = 0; i < 7; i++) {
                const d = start.add_days(i);
                const key = d.format('%Y-%m-%d');
                if (e.allDay ? e.startDate <= key && e.endDate > key
                    : e.end > d.to_unix() && e.start < d.add_days(1).to_unix())
                    busy.add(i);
            }
        }
        for (let i = 0; i < 7; i++) {
            const d = start.add_days(i);
            const weekend = [0, 6].includes(d.get_day_of_week() % 7);
            const isToday = d.get_day_of_month() === now.get_day_of_month() && d.get_month() === now.get_month();
            const name = new St.Label({style_class: `tahoe-sched-weekday${weekend ? ' tahoe-sched-weekend' : ''}`,
                text: d.format('%a').toUpperCase(), x_align: Clutter.ActorAlign.CENTER});
            const num = new St.Bin({
                style_class: `tahoe-sched-date${weekend ? ' tahoe-sched-weekend' : ''}${isToday ? ' tahoe-sched-date-today' : ''}`,
                x_align: Clutter.ActorAlign.CENTER,
                child: new St.Label({text: String(d.get_day_of_month()),
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
            });
            const dot = new St.Widget({style_class: 'tahoe-sched-dot', x_align: Clutter.ActorAlign.CENTER,
                opacity: busy.has(i) && !isToday ? 255 : 0});
            grid.attach(name, i, 0, 1, 1);
            grid.attach(num, i, 1, 1, 1);
            grid.attach(dot, i, 2, 1, 1);
        }
    }

    _when(row) {
        if (row.fromBefore)
            return `Until ${clock(row.end)}`;
        if (row.pastToday)
            return `From ${clock(row.start)}`;
        return range(row.start, row.end);
    }
}
