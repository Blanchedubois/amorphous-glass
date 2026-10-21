// The login screen's clock in Liquid Glass, as the lock screen's (tahoe-lockscreen layout.js): the
// date above the time, in Space Grotesk SemiBold, the digits 12 % of the monitor's height, the
// date's letters at 10.8 %, each a glass pane shaped like its glyphs (clockpanes.js, shared with
// the lock screen) in the clock's glass (B2 clear blur, the user's pick). The time as the login
// screen's clock format: 12 h without AM/PM (as the lock screen) or 24 h.
// GNOME's own panel clock stays, transparent (its menu still opens).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './glass.js';
import {ClockPanes, clockMaterial} from './clockpanes.js';

// tahoe-lockscreen/layout.js
const DIGITS = 0.12;          // the digits' height, share of the monitor's
const DIGITS_EM = 0.730;      // Space Grotesk's digit height
const DATE_TOP = 0.108;       // the top of the date's letters
const DATE_RATIO = 0.1825;    // date type size / time type size
const GAP_RATIO = 0.0827;     // gap under the date's letters / time type size
const CAP_HEIGHT = 0.741;

export function buildClock(ext) {
    const group = Main.screenShield?._lockDialogGroup;
    const backdrop = ext.backdrop;   // the picture's actor (nowplaying.js buildBackdrop)
    if (!group || !backdrop)
        throw new Error('no backdrop for the clock');

    const layer = new Clutter.Actor({name: 'tahoe-gdm-clock', reactive: false});
    group.add_child(layer);
    ext._undo.push(() => layer.destroy());

    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const panes = new ClockPanes(layer, backdrop, GlassPane, reason => ext._fail(`clock glass: ${reason}`));
    ext._undo.push(() => panes.destroy());
    const place = (key, text, size, top, material) => {
        const monitor = Main.layoutManager.primaryMonitor;
        panes.place(key, text, size, monitor.y + top, monitor.x, monitor.width, material);
    };

    const update = () => {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const H = monitor.height;
        const timeSize = Math.round(DIGITS / DIGITS_EM * H);
        const dateSize = Math.round(timeSize * DATE_RATIO);
        const now = GLib.DateTime.new_now_local();
        const h24 = settings.get_string('clock-format') === '24h';
        const time = now.format(h24 ? '%H:%M' : '%l:%M').trim();
        const date = now.format('%a %b %-d');
        const dateTop = DATE_TOP * H;
        const digitsTop = dateTop + dateSize * CAP_HEIGHT + timeSize * GAP_RATIO;
        place('date', date, dateSize, dateTop, clockMaterial(timeSize, true));
        place('time', time, timeSize, digitsTop, clockMaterial(timeSize, false));
    };
    const guarded = () => {
        try {
            update();
        } catch (e) {
            ext._fail(`clock: ${e}`);
        }
    };

    const wallClock = new GnomeDesktop.WallClock({time_only: true});
    const ids = [
        [wallClock, wallClock.connect('notify::clock', guarded)],
        [settings, settings.connect('changed::clock-format', guarded)],
        [Main.layoutManager, Main.layoutManager.connect('monitors-changed', guarded)],
    ];
    ext._undo.push(() => {
        ids.forEach(([obj, id]) => obj.disconnect(id));
        wallClock.run_dispose();
    });

    // GNOME's clock: there, transparent
    const gnomeClock = Main.panel?.statusArea?.dateMenu?._clockDisplay;
    if (gnomeClock) {
        const old = gnomeClock.opacity;
        gnomeClock.opacity = 0;
        ext._undo.push(() => {
            gnomeClock.opacity = old;
        });
    }

    update();
}
