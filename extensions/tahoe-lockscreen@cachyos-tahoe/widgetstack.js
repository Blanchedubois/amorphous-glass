// The widget column on the lock screen (the user's design A, 2026-10-20, after the iPad's
// landscape lock screen): small desktop widgets stacked on the left, each on Liquid Glass over
// the lock background (and so over music mode's swirl when it plays). As many as fit the monitor.
//
// Privacy: everything here is readable by anyone at the locked machine. The user's choice
// (2026-10-20): no event titles on the lock screen, so the column is the weather and the month;
// "calendar-day" (today with the rest of today's event titles) stays available but is not used.
// The weather widget updates over the network while locked (GNOME's weather client, the
// location set in GNOME Weather); "weather-small" out of the list stops that.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {CalendarDay, CalendarMedium, CalendarMonth} from './widgets/calendar.js';
import {AnalogClock, AnalogQuartersClock} from './widgets/clocks.js';
import {GlassPane} from './widgets/paneglass.js';
import {WeatherMedium, WeatherSmall} from './widgets/weather.js';
import {SIZE, arrange, layoutRows, widthOf} from './widgets/widgetlayout.js';

// the rows of the column (widgetlayout.js, shared with the login screen); a test may set rows
export const WIDGET_STACK = {rows: null};

// calendars without events here (the user's rule); "calendar-day" with events stays available
const KINDS = {
    'weather-small': () => new WeatherSmall(),
    'weather-medium': () => new WeatherMedium(),
    'calendar-day': () => new CalendarDay(),
    'calendar-month': () => new CalendarMonth({events: false}),
    'calendar-medium': () => new CalendarMedium({events: false}),
    'clock-analog': () => new AnalogClock(),
    'clock-quarters': () => new AnalogQuartersClock(),
};
const RADIUS = 24;         // tokens/radius.json widget
const LEFT = 0.045;        // the column's left edge, share of the monitor's width
const MARGIN = 0.04;       // clear of the monitor's top and bottom, share of its height
const WEATHER_WAIT = 4000; // ms: the weather shows by then, forecast or not

// backdrop: () => the primary monitor's lock background actor; gate: nowplaying.js' (not idle or dimming)
export function buildWidgetStack(frame, dialog, backdrop, gate) {
    const rows = (WIDGET_STACK.rows ?? layoutRows()).map(row => row.filter(k => KINDS[k])).filter(row => row.length);
    const kinds = rows.flat();
    if (kinds.length === 0)
        return {place() {}};

    const layer = new St.Widget({name: 'widget-stack-layer', reactive: false, layout_manager: new Clutter.FixedLayout()});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);

    const items = kinds.map(kind => {
        const actor = new St.Widget({
            style_class: `tahoe-widget tahoe-widget-${kind} tahoe-lock-pane`,
            layout_manager: new Clutter.BinLayout(),
            width: widthOf(kind), height: SIZE,
        });
        actor.add_child(new GlassPane(backdrop, RADIUS));
        const content = new St.Widget({
            style_class: 'tahoe-widget-content',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true,
        });
        const widget = KINDS[kind]();
        content.add_child(widget.actor);
        actor.add_child(content);
        layer.add_child(actor);
        // the weather shows once it has its forecast, not "Loading…" first (a flash on Super+L,
        // 2026-10-20): faded in then, or after WEATHER_WAIT whatever it has
        const client = widget._client;
        if (client) {
            actor.opacity = 0;
            const show = () => {
                if (actor.opacity === 0)
                    actor.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            };
            if (client.hasLocation && client.info?.is_valid?.()) {
                actor.opacity = 255;
            } else {
                frame.connect(client, 'changed', () => {
                    if (client.info?.is_valid?.())
                        show();
                });
                let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WEATHER_WAIT, () => {
                    id = 0;
                    frame.guard(show);
                    return GLib.SOURCE_REMOVE;
                });
                frame.addUndo(() => {
                    if (id)
                        GLib.source_remove(id);
                    id = 0;
                });
            }
        }
        return {kind, actor, widget};
    });
    frame.addUndo(() => items.forEach(({widget}) => widget.destroy()));

    // one tick a second for all of them (the calendar turns over at midnight and lists the next
    // events each minute, the weather each hour), only while the gate allows
    let tickId = 0;
    const tick = () => {
        const now = GLib.DateTime.new_now_local();
        for (const {actor, widget} of items)
            if (actor.visible)
                widget.tick(now);
    };
    const syncTick = () => {
        if (gate() && !tickId) {
            tick();
            tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => frame.guard(() => {
                if (!gate())
                    return (tickId = 0, GLib.SOURCE_REMOVE);
                tick();
                return GLib.SOURCE_CONTINUE;
            }) ?? GLib.SOURCE_REMOVE);
        }
    };
    frame.addUndo(() => {
        if (tickId)
            GLib.source_remove(tickId);
        tickId = 0;
    });
    tick();   // the first contents, whatever the gate
    syncTick();

    frame.addCheck('widget stack', () => {
        for (const {kind, actor} of items) {
            if (actor.visible && !actor.mapped)
                return `the ${kind} widget is not shown`;
        }
        return null;
    });

    return {
        // the column on this monitor: as many widgets as fit, centred on its height
        place(monitorBox) {
            const {spots, scale} = arrange(rows, monitorBox, monitorBox.x + LEFT * monitorBox.width, MARGIN);
            items.forEach((item, i) => {
                item.actor.visible = spots[i].visible;
                item.actor.set_position(spots[i].x, spots[i].y);
                item.actor.set_scale(scale, scale);
            });
            syncTick();
        },
        // the gate opened again (input after idle): start the tick
        recheck: () => frame.guard(syncTick),
    };
}
