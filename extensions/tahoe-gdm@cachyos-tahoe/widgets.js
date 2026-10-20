// The widget column on the login screen, as the lock screen's (tahoe-lockscreen widgetstack.js):
// the weather and the month, the desktop's small widgets (exact copies in widgets/,
// tools/gdm/shared.list), each on Liquid Glass over the login picture, stacked on the left.
//
// The login screen runs as a system account: the weather's location comes from the login
// screen's own settings (org.gnome.shell.weather, set at install from the user's: the user's
// choice, 2026-10-20), and the weather is fetched over the network from here. The month calendar
// shows no events (the login screen cannot read the user's calendars).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './glass.js';
import {CalendarMonth} from './widgets/calendar.js';
import {WeatherSmall} from './widgets/weather.js';

const KINDS = [['weather-small', WeatherSmall], ['calendar-month', CalendarMonth]];
const SIZE = 170;          // tahoe-widgets SIZES.small, logical px
const GAP = 16;            // between widgets, as on the desktop grid
const RADIUS = 24;         // tokens/radius.json widget
const LEFT = 0.045;        // the column's left edge, share of the monitor's width
const MARGIN = 0.04;       // clear of the monitor's top and bottom, share of its height
const TICK = 10;           // s: the calendar turns over at midnight, the weather each hour
const WEATHER_WAIT = 4000; // ms: the weather shows by then, forecast or not

export function buildWidgets(ext, dir) {
    const group = Main.screenShield?._lockDialogGroup;
    const backdrop = ext.backdrop;   // the picture's actor (nowplaying.js buildBackdrop)
    if (!group || !backdrop)
        throw new Error('no backdrop for the widgets');

    // the widgets' own styles (the desktop's stylesheet), loaded while the login screen shows
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const css = dir.get_child('widgets').get_child('widgets.css');
    theme.load_stylesheet(css);
    ext._undo.push(() => theme.unload_stylesheet(css));

    const layer = new Clutter.Actor({name: 'tahoe-gdm-widgets', reactive: false});
    group.add_child(layer);
    ext._undo.push(() => layer.destroy());

    const items = KINDS.map(([kind, cls]) => {
        const actor = new St.Widget({
            style_class: `tahoe-widget tahoe-widget-${kind} tahoe-gdm-pane`,
            layout_manager: new Clutter.BinLayout(),
            width: SIZE, height: SIZE,
        });
        const pane = new GlassPane(backdrop, RADIUS);
        pane.connect('mask-failed', () => ext._fail(`widget glass: ${pane.failed}`));
        actor.add_child(pane);
        const content = new St.Widget({
            style_class: 'tahoe-widget-content',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true,
        });
        const widget = new cls();
        content.add_child(widget.actor);
        actor.add_child(content);
        layer.add_child(actor);
        // the weather shows once it has its forecast, not "Loading…" first: faded in then, or
        // after WEATHER_WAIT whatever it has (no network yet at boot, say)
        const client = widget._client;
        if (client && !(client.hasLocation && client.info?.is_valid?.())) {
            actor.opacity = 0;
            const show = () => {
                if (actor.opacity === 0)
                    actor.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            };
            const changedId = client.connect('changed', () => {
                if (client.info?.is_valid?.())
                    show();
            });
            let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WEATHER_WAIT, () => {
                id = 0;
                show();
                return GLib.SOURCE_REMOVE;
            });
            ext._undo.push(() => {
                if (id)
                    GLib.source_remove(id);
                id = 0;
                client.disconnect(changedId);
            });
        }
        return {actor, widget};
    });
    ext._undo.push(() => items.forEach(({widget}) => widget.destroy()));

    const tick = () => {
        const now = GLib.DateTime.new_now_local();
        items.forEach(({widget}) => widget.tick(now));
    };
    const tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK, () => {
        try {
            tick();
        } catch (e) {
            ext._fail(`widgets: ${e}`);
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    ext._undo.push(() => GLib.source_remove(tickId));

    // the column on the primary monitor: as many as fit, centred on its height
    const place = () => {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        let n = items.length;
        while (n > 1 && n * SIZE + (n - 1) * GAP > m.height * (1 - 2 * MARGIN))
            n--;
        let y = Math.round(m.y + (m.height - (n * SIZE + (n - 1) * GAP)) / 2);
        const x = Math.round(m.x + LEFT * m.width);
        items.forEach((item, i) => {
            item.actor.visible = i < n;
            if (i < n) {
                item.actor.set_position(x, y);
                y += SIZE + GAP;
            }
        });
    };
    const id = Main.layoutManager.connect('monitors-changed', place);
    ext._undo.push(() => Main.layoutManager.disconnect(id));

    tick();
    place();
}
