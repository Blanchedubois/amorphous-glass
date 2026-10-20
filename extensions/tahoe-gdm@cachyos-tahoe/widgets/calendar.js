// Calendar widgets: day (small), month (small) and day with month (medium).
// Events come from GNOME's calendar server (Evolution Data Server), as in the top bar's calendar.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

import {use24h} from './clocks.js';

const MAX_EVENTS = {small: 2, medium: 3};

// One event source for every calendar widget, made once per shell session and kept across
// disable/enable (every screen lock): the shell's DBusEventSource cannot cancel its start-up,
// so destroying it while it starts (a quick lock and unlock) leaves it using a disposed proxy.
// The shell's own calendar keeps its source for good too; the widgets only disconnect.
let eventSource = null;

function acquireEvents() {
    eventSource ??= new Calendar.DBusEventSource();
    return eventSource;
}

// the first day of the week: GNOME's setting, else the locale's
function weekStart() {
    try {
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.calendar'});
        const day = settings.get_enum('week-start-day');
        if (day !== 0)   // 0 = locale default
            return day % 7;
    } catch {}
    return Shell.util_get_week_start();
}

const dayKey = now => now.format('%Y-%m-%d');

function formatEventTime(event) {
    const start = GLib.DateTime.new_from_unix_local(Math.floor(event.date.getTime() / 1000));
    const length = event.end.getTime() - event.date.getTime();
    if (start.get_hour() === 0 && start.get_minute() === 0 && length > 0 && length % 86400000 === 0)
        return 'All day';
    return use24h() ? start.format('%H:%M') : start.format('%l:%M %p').trim();
}

// today's events that have not ended yet
function remainingEvents(source, now) {
    const begin = new Date(now.get_year(), now.get_month() - 1, now.get_day_of_month());
    const end = new Date(begin.getTime() + 86400000);
    source.requestRange(begin, end);
    const nowDate = new Date();
    return source.getEvents(begin, end).filter(e => e.end > nowDate);
}

// weekday, big day number and the rest of today's events
class DayPane {
    constructor(maxEvents) {
        this._maxEvents = maxEvents;
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-cal-day',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._weekday = new St.Label({style_class: 'tahoe-widget-accent'});
        this._day = new St.Label({style_class: 'tahoe-cal-daynum'});
        this._events = new St.BoxLayout({
            style_class: 'tahoe-cal-events',
            orientation: Clutter.Orientation.VERTICAL,
            y_expand: true,
            y_align: Clutter.ActorAlign.END,
        });
        this.actor.add_child(this._weekday);
        this.actor.add_child(this._day);
        this.actor.add_child(this._events);
    }

    // events: null for none shown at all (not even "No more events today")
    update(now, events) {
        this._weekday.text = now.format('%A').toUpperCase();
        this._day.text = String(now.get_day_of_month());
        this._events.destroy_all_children();
        if (events === null)
            return;
        if (events.length === 0) {
            const none = new St.Label({style_class: 'tahoe-widget-secondary', text: 'No more events today'});
            none.clutter_text.line_wrap = true;
            this._events.add_child(none);
            return;
        }
        for (const event of events.slice(0, this._maxEvents)) {
            const row = new St.BoxLayout({style_class: 'tahoe-cal-event'});
            row.add_child(new St.Widget({style_class: 'tahoe-cal-event-bar'}));
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            const title = new St.Label({style_class: 'tahoe-cal-event-title', text: event.summary || 'Event'});
            title.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
            text.add_child(title);
            text.add_child(new St.Label({style_class: 'tahoe-widget-secondary tahoe-cal-event-time',
                text: formatEventTime(event)}));
            row.add_child(text);
            this._events.add_child(row);
        }
    }
}

// month name and the month's days, today in a red circle
class MonthPane {
    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-cal-month',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._title = new St.Label({style_class: 'tahoe-widget-accent'});
        this._grid = new St.Widget({
            style_class: 'tahoe-cal-grid',
            layout_manager: new Clutter.GridLayout({column_homogeneous: true, row_homogeneous: true}),
            x_expand: true, y_expand: true,
        });
        this.actor.add_child(this._title);
        this.actor.add_child(this._grid);
    }

    update(now) {
        this._title.text = now.format('%B').toUpperCase();
        this._grid.destroy_all_children();
        const grid = this._grid.layout_manager;
        const start = weekStart();
        const cell = (label, styles, col, row) => {
            const bin = new St.Bin({x_expand: true, y_expand: true, child: new St.Label({
                style_class: styles, text: label,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            })});
            grid.attach(bin, col, row, 1, 1);
        };
        // weekday initials, from a known week (Sunday 2023-01-01)
        for (let i = 0; i < 7; i++) {
            const wd = (start + i) % 7;
            const label = GLib.DateTime.new_local(2023, 1, 1 + wd, 0, 0, 0).format('%a').slice(0, 1).toUpperCase();
            cell(label, 'tahoe-cal-weekday', i, 0);
        }
        const first = GLib.DateTime.new_local(now.get_year(), now.get_month(), 1, 0, 0, 0);
        const offset = ((first.get_day_of_week() % 7) - start + 7) % 7;
        const days = GLib.Date.get_days_in_month(now.get_month(), now.get_year());
        for (let d = 1; d <= days; d++) {
            const index = offset + d - 1;
            const col = index % 7;
            const weekend = [0, 6].includes((start + col) % 7);
            const styles = ['tahoe-cal-date'];
            if (weekend)
                styles.push('tahoe-cal-weekend');
            if (d === now.get_day_of_month())
                styles.push('tahoe-cal-today');
            cell(String(d), styles.join(' '), col, 1 + Math.floor(index / 7));
        }
    }
}

class CalendarWidget {
    // events: false leaves the events out (the lock and login screens: the user's rule, no event
    // titles there); the calendar store is then not opened at all
    constructor({events = true} = {}) {
        this._day = null;
        this._showEvents = events;
        this._source = events ? acquireEvents() : null;
        this._source?.connectObject('changed', () => this._refresh(true), this);
    }

    _events(now) {
        return this._source ? remainingEvents(this._source, now) : null;
    }

    setMode() {}

    tick(now) {
        // the grid and day change once a day, the event list once a minute
        const key = dayKey(now);
        if (key !== this._day || now.get_second() === 0) {
            this._now = now;
            this._refresh(key !== this._day);
            this._day = key;
        }
    }

    _refresh(dayChanged) {
        if (!this._now)
            return;
        this.update(this._now, dayChanged);
    }

    destroy() {
        this._source?.disconnectObject(this);
        this.actor.destroy();
    }
}

export class CalendarDay extends CalendarWidget {
    static size = 'small';

    constructor(options) {
        super(options);
        this._pane = new DayPane(MAX_EVENTS.small);
        this.actor = this._pane.actor;
    }

    update(now) {
        this._pane.update(now, this._events(now));
    }
}

export class CalendarMonth extends CalendarWidget {
    static size = 'small';

    constructor(options) {
        super(options);
        this._pane = new MonthPane();
        this.actor = this._pane.actor;
    }

    update(now, dayChanged) {
        if (dayChanged)
            this._pane.update(now);
    }
}

export class CalendarMedium extends CalendarWidget {
    static size = 'medium';

    constructor(options) {
        super(options);
        this.actor = new St.BoxLayout({style_class: 'tahoe-cal-medium', x_expand: true, y_expand: true});
        this._dayPane = new DayPane(MAX_EVENTS.medium);
        this._monthPane = new MonthPane();
        this.actor.add_child(this._dayPane.actor);
        this.actor.add_child(this._monthPane.actor);
    }

    update(now, dayChanged) {
        this._dayPane.update(now, this._events(now));
        if (dayChanged)
            this._monthPane.update(now);
    }
}
