// Schedule widgets: what is left of today from a calendar's private ICS link (icsfeed.js).
// Small (170 x 170): the weekday and day, then up to 3 rows. Large (356 x 356): the day, the
// week with today circled and a dot under days with events, then up to 4 rows with time ranges.
// What the rows say comes from schedule-model.js. Desktop only: the lock screen does not carry
// this file.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {acquireFeed, Status} from './icsfeed.js';
import {use24h} from './clocks.js';
import {nowColor, schedule, timeLine, updatedAt, week} from './schedule-model.js';

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

// the time the widgets see; the headless tests set another one (setClockForTests)
let clockNow = () => GLib.DateTime.new_now_local();
export function setClockForTests(fn) {
    clockNow = fn ?? (() => GLib.DateTime.new_now_local());
}

class ScheduleWidget {
    static size = 'small';

    constructor() {
        this._feed = acquireFeed();
        this._mode = 'dark';
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

    setMode(mode) {
        this._mode = mode;
        this._key = null;   // the "now" colour follows the mode
        this._refresh();
    }

    get wantsSeconds() {
        return false;
    }

    // the extension's minute tick (and nothing under a fullscreen window); the feed's signals
    // refresh too, with the time then (after a suspend the next tick can be up to a minute late)
    tick() {
        this._refresh();
    }

    _refresh() {
        if (!this._feed)
            return;
        const now = clockNow();
        this._feed.ensureWindow(now);
        const rows = schedule(this._feed.events, now);
        const h24 = use24h();
        const state = this._state(rows, now, h24);
        // actors change only when what they say changes: the header once a day (and with new
        // events), the rows when a row's text does ("in 8 min" under the hour, past events going)
        const headerKey = `${now.format('%Y-%m-%d')} ${this._version}`;
        if (headerKey !== this._headerKey) {
            this._headerKey = headerKey;
            this._header(now);
        }
        const large = this.constructor.large;
        const lines = rows.map(r => timeLine(r, now, {h24, large}));
        const key = JSON.stringify([state, rows.map((r, i) => [r.title, r.color, r.now, lines[i]])]);
        if (key === this._key)
            return;
        this._key = key;
        this._fill(rows, lines, state);
    }

    // what to say instead of the events ({empty: [title, detail]}) or under them ({footer: [...]})
    _state(rows, now, h24) {
        const feed = this._feed;
        const have = feed.events.length > 0;
        const since = updatedAt(feed.updated, now, h24);
        const say = (title, detail, emptyDetail = detail) => {
            if (!have)
                return {empty: [title, emptyDetail]};
            return rows.length ? {footer: [title, detail]} : {empty: ['No more events today', detail ? `${title} · ${detail}` : title]};
        };
        switch (feed.status) {
        case Status.NONE:
            return {empty: ['No calendar link', 'tahoe-widgets.sh calendar-url']};
        case Status.LOCKED:
            return say('Calendar locked', '', 'Unlock to show events');
        case Status.INVALID:
            return say('Calendar link not valid', '', 'Set it again: tahoe-widgets.sh calendar-url');
        case Status.OFFLINE:
            return say("Can't reach calendar", since ? `updated ${since}` : '', 'Will retry');
        case Status.LOADING:
            if (!have)
                return {empty: ['Loading calendar…', '']};
        }
        return rows.length ? {} : {empty: ['No more events today', '']};
    }

    _fill(rows, lines, state) {
        this._rows.destroy_all_children();
        if (state.empty) {
            this._emptyState(...state.empty);
            return;
        }
        // the small widget's footer takes the last row's place
        const cap = this.constructor.maxRows;
        const footer = Boolean(state.footer) || rows.length > cap;
        const fit = footer && this.constructor.footerTakesRow ? cap - 1 : cap;
        rows.slice(0, fit).forEach((row, i) => this._rows.add_child(this._row(row, lines[i])));
        const [title, detail] = state.footer ?? (rows.length > fit ? [`+${rows.length - fit} more`, ''] : [null, '']);
        if (title) {
            this._rows.add_child(new St.Widget({y_expand: true}));
            // two lines on the small widget, one on the large
            const text = detail ? `${title}${this.constructor.large ? ' · ' : '\n'}${detail}` : title;
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
    _row(row, [when, rel]) {
        const box = new St.BoxLayout({style_class: 'tahoe-sched-row', x_expand: true});
        // fills the row's height without y_expand (which would spread to the row and stretch it)
        box.add_child(new St.Widget({style_class: 'tahoe-sched-bar', style: `background-color: ${row.color};`}));
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const time = new St.Label({style_class: 'tahoe-widget-secondary tahoe-sched-time'});
        time.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
        if (row.now) {
            time.add_style_class_name('tahoe-sched-time-now');
            const color = nowColor(row.color, this._mode);
            if (color)
                time.style = `color: ${color};`;
        }
        time.clutter_text.set_markup(rel ? `${esc(when)}  <i>${esc(rel)}</i>` : esc(when));
        const title = new St.Label({style_class: 'tahoe-sched-title', text: row.title});
        title.clutter_text.ellipsize = 3;
        text.add_child(time);
        text.add_child(title);
        box.add_child(text);
        return box;
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
    static large = false;

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
}

export class ScheduleLarge extends ScheduleWidget {
    static size = 'large';
    static styleClass = 'tahoe-sched-large';
    static maxRows = 4;
    static footerTakesRow = false;
    static emptyAlign = Clutter.ActorAlign.CENTER;
    static large = true;

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
        week(this._feed.events, now, weekStart()).forEach((day, i) => {
            const weekend = day.weekend ? ' tahoe-sched-weekend' : '';
            grid.attach(new St.Label({style_class: `tahoe-sched-weekday${weekend}`,
                text: day.date.format('%a').toUpperCase(), x_align: Clutter.ActorAlign.CENTER}), i, 0, 1, 1);
            grid.attach(new St.Bin({
                style_class: `tahoe-sched-date${weekend}${day.today ? ' tahoe-sched-date-today' : ''}`,
                x_align: Clutter.ActorAlign.CENTER,
                child: new St.Label({text: String(day.date.get_day_of_month()),
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
            }), i, 1, 1, 1);
            grid.attach(new St.Widget({style_class: 'tahoe-sched-dot', x_align: Clutter.ActorAlign.CENTER,
                opacity: day.busy ? 255 : 0}), i, 2, 1, 1);
        });
    }
}
