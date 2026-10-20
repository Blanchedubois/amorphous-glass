// Weather widgets: now (small), now with the next hours (medium), and the week as well (large).
// Layout after the Tahoe weather widget, as ported in jaxparrow07/liquidglass-kde-widgets
// (GPL-3.0); no code or assets are taken from it. The KDE version tints its card by the weather,
// the glass standard paints no fill over the glass, so here only the content changes.
//
// The data is GNOME's own: the shell's WeatherClient (libgweather), with the location set in
// GNOME Weather, as in the top bar's calendar. One client for every weather widget; it never
// refreshes on its own, so it is asked to every 30 minutes.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import St from 'gi://St';

import * as Weather from 'resource:///org/gnome/shell/misc/weather.js';

import {use24h} from './clocks.js';

const REFRESH_SECONDS = 30 * 60;
const HOURS = 6;
const DAYS = 5;

let client = null;
let clientUsers = 0;
let refreshId = 0;

function acquireClient() {
    if (!client) {
        client = new Weather.WeatherClient();
        client.update();
        refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, REFRESH_SECONDS, () => {
            client.update();
            return GLib.SOURCE_CONTINUE;
        });
    }
    clientUsers++;
    return client;
}

function releaseClient() {
    if (--clientUsers > 0)
        return;
    GLib.source_remove(refreshId);
    refreshId = 0;
    // the shell's client has no teardown; with nothing connected and no refresh it stays idle
    client = null;
}

const temp = info => {
    const [ok, value] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
    return ok ? Math.round(value) : null;
};
const degrees = t => (t === null ? '--' : `${t}°`);

function when(info) {
    const [ok, stamp] = info.get_value_update();
    return ok ? GLib.DateTime.new_from_unix_local(stamp) : null;
}

function conditionText(info) {
    const conditions = info.get_conditions();
    const text = conditions && conditions !== '-' ? conditions : info.get_sky();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function placeName(info) {
    return info.get_location()?.get_city_name() ?? info.get_location_name() ?? '';
}

function hourLabel(time) {
    return use24h() ? time.format('%H') : time.format('%l %p').trim();
}

// the forecast entries, grouped into days: [{date, low, high, icon}]
function daily(info) {
    const days = new Map();
    const add = (entry, time) => {
        const t = temp(entry);
        if (t === null || !time)
            return;
        const key = time.format('%Y-%m-%d');
        const day = days.get(key) ?? {time, low: t, high: t, icon: null, iconHour: 99};
        day.low = Math.min(day.low, t);
        day.high = Math.max(day.high, t);
        // the icon nearest to midday tells the day's weather
        const off = Math.abs(time.get_hour() - 13);
        if (off < day.iconHour) {
            day.iconHour = off;
            day.icon = entry.get_symbolic_icon_name();
        }
        days.set(key, day);
    };
    add(info, GLib.DateTime.new_now_local());
    for (const entry of info.get_forecast_list())
        add(entry, when(entry));
    return [...days.values()].sort((a, b) => a.time.compare(b.time));
}

// the next hours after now: [{time, icon, temp}]
function hourly(info, count) {
    const now = GLib.DateTime.new_now_local();
    const list = info.get_forecast_list()
        .map(entry => ({entry, time: when(entry)}))
        .filter(({time}) => time && time.compare(now) > 0)
        .slice(0, count - 1)
        .map(({entry, time}) => ({label: hourLabel(time), icon: entry.get_symbolic_icon_name(), temp: temp(entry)}));
    return [{label: 'Now', icon: info.get_symbolic_icon_name(), temp: temp(info)}, ...list];
}

const label = (style, text = '') => new St.Label({style_class: style, text});
const icon = (style, size) => new St.Icon({style_class: style, icon_size: size, icon_name: 'weather-clear-symbolic'});

// place, temperature, condition and the day's high and low
class NowPane {
    constructor(wide) {
        this._wide = wide;
        this.actor = new St.BoxLayout({style_class: 'tahoe-weather-now', x_expand: true});
        const left = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._place = label('tahoe-weather-place');
        this._place.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
        this._temp = label('tahoe-weather-temp');
        left.add_child(this._place);
        left.add_child(this._temp);
        this.actor.add_child(left);

        const right = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: wide ? Clutter.ActorAlign.END : Clutter.ActorAlign.FILL,
        });
        this._icon = icon('tahoe-weather-icon', 18);
        this._icon.x_align = wide ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        this._condition = label('tahoe-weather-condition');
        this._condition.clutter_text.ellipsize = 3;
        this._range = label('tahoe-weather-condition');
        for (const a of [this._condition, this._range])
            a.x_align = wide ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        right.add_child(this._icon);
        right.add_child(this._condition);
        right.add_child(this._range);
        if (wide) {
            this.actor.add_child(right);
        } else {
            // small: everything in one column, the condition at the bottom
            this.actor.orientation = Clutter.Orientation.VERTICAL;
            this.actor.y_expand = true;
            this.actor.add_child(new St.Widget({y_expand: true}));
            this.actor.add_child(right);
        }
    }

    update(info, days) {
        this._place.text = placeName(info);
        this._temp.text = degrees(temp(info));
        this._icon.icon_name = info.get_symbolic_icon_name();
        this._condition.text = conditionText(info);
        const today = days[0];
        this._range.text = today ? `H:${today.high}° L:${today.low}°` : '';
    }

    message(place, text) {
        this._place.text = place;
        this._temp.text = '--';
        this._icon.icon_name = 'weather-severe-alert-symbolic';
        this._condition.text = text;
        this._range.text = '';
    }
}

// the next hours: time, icon, temperature in columns
class HourlyPane {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'tahoe-weather-hourly', x_expand: true});
        this._columns = [];
        for (let i = 0; i < HOURS; i++) {
            const col = new St.BoxLayout({
                style_class: 'tahoe-weather-hour',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
            });
            const parts = [label('tahoe-widget-secondary tahoe-weather-small'), icon('tahoe-weather-icon', 18),
                label('tahoe-weather-hour-temp')];
            parts.forEach(p => {
                p.x_align = Clutter.ActorAlign.CENTER;
                col.add_child(p);
            });
            this.actor.add_child(col);
            this._columns.push(parts);
        }
    }

    update(info) {
        const hours = hourly(info, HOURS);
        this._columns.forEach(([time, ic, t], i) => {
            const h = hours[i];
            time.text = h?.label ?? '';
            ic.icon_name = h?.icon ?? 'weather-clear-symbolic';
            ic.opacity = h ? 255 : 0;
            t.text = h ? degrees(h.temp) : '';
        });
    }
}

// the coming days: weekday, icon, low, the range on the week's scale, high
class DailyPane {
    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-weather-daily',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._rows = [];
        for (let i = 0; i < DAYS; i++) {
            const row = new St.BoxLayout({style_class: 'tahoe-weather-day', y_expand: true});
            const day = label('tahoe-weather-day-name');
            const ic = icon('tahoe-weather-icon', 18);
            const low = label('tahoe-widget-secondary tahoe-weather-day-temp');
            const track = new St.Widget({
                style_class: 'tahoe-weather-track',
                layout_manager: new Clutter.FixedLayout(),
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            const fill = new St.Widget({style_class: 'tahoe-weather-fill'});
            track.add_child(fill);
            const high = label('tahoe-weather-day-temp');
            for (const a of [day, ic, low, high])
                a.y_align = Clutter.ActorAlign.CENTER;
            low.clutter_text.x_align = Clutter.ActorAlign.END;
            [day, ic, low, track, high].forEach(a => row.add_child(a));
            track.connect('notify::width', () => this._placeFill(this._rows[i]));
            this.actor.add_child(row);
            this._rows.push({row, day, ic, low, track, fill, high, span: null});
        }
    }

    _placeFill(r) {
        if (!r.span)
            return;
        const [a, b] = r.span;
        const w = r.track.width;
        r.fill.set_position(Math.round(a * w), 0);
        r.fill.set_size(Math.max(r.track.height, Math.round((b - a) * w)), r.track.height);
    }

    update(days) {
        const shown = days.slice(0, DAYS);
        const min = Math.min(...shown.map(d => d.low)), max = Math.max(...shown.map(d => d.high));
        const scale = t => (max > min ? (t - min) / (max - min) : 0);
        this._rows.forEach((r, i) => {
            const d = shown[i];
            r.row.opacity = d ? 255 : 0;
            if (!d)
                return;
            r.day.text = i === 0 ? 'Today' : d.time.format('%a');
            r.ic.icon_name = d.icon ?? 'weather-clear-symbolic';
            r.low.text = `${d.low}°`;
            r.high.text = `${d.high}°`;
            r.span = [scale(d.low), scale(d.high)];
            this._placeFill(r);
        });
    }
}

class WeatherWidget {
    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-weather',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._panes = [];
        this._build();
        this._client = acquireClient();
        this._client.connectObject('changed', () => this._refresh(), this);
        this._refresh();
    }

    setMode() {}

    // the hourly columns move on with the hour
    tick(now) {
        if (now.get_minute() === 0 && now.get_second() === 0)
            this._refresh();
    }

    _refresh() {
        const c = this._client;
        if (!c.hasLocation) {
            this._now.message('Weather', 'Set a location in GNOME Weather');
            this._hideDetail(true);
            return;
        }
        const info = c.info;
        if (!info.is_valid()) {
            this._now.message(placeName(info) || 'Weather', c.loading ? 'Loading…' : 'No weather data');
            this._hideDetail(true);
            return;
        }
        this._hideDetail(false);
        const days = daily(info);
        this._now.update(info, days);
        this._hourly?.update(info);
        this._daily?.update(days);
    }

    _hideDetail(hide) {
        for (const pane of [this._hourly, this._daily, this._separator])
            if (pane)
                (pane.actor ?? pane).opacity = hide ? 0 : 255;
    }

    destroy() {
        this._client.disconnectObject(this);
        this._client = null;
        releaseClient();
        this.actor.destroy();
    }
}

export class WeatherSmall extends WeatherWidget {
    static size = 'small';

    _build() {
        this._now = new NowPane(false);
        this.actor.add_child(this._now.actor);
    }
}

export class WeatherMedium extends WeatherWidget {
    static size = 'medium';

    _build() {
        this._now = new NowPane(true);
        this._hourly = new HourlyPane();
        this.actor.add_child(this._now.actor);
        this.actor.add_child(new St.Widget({y_expand: true}));
        this.actor.add_child(this._hourly.actor);
    }
}

export class WeatherLarge extends WeatherWidget {
    static size = 'large';

    _build() {
        this._now = new NowPane(true);
        this._hourly = new HourlyPane();
        this._separator = new St.Widget({style_class: 'tahoe-weather-separator'});
        this._daily = new DailyPane();
        this.actor.add_child(this._now.actor);
        this.actor.add_child(this._hourly.actor);
        this.actor.add_child(this._separator);
        this.actor.add_child(this._daily.actor);
    }
}
