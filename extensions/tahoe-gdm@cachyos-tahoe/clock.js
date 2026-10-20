// The login screen's clock in Liquid Glass, as the lock screen's (tahoe-lockscreen layout.js and
// glassclock.js): the date above the time, in Space Grotesk SemiBold, the digits 12 % of the
// monitor's height, the date's letters at 10.8 %, each a glass pane shaped like its glyphs
// (glass.js, a glyph mask) over the login screen's picture, so the strokes bend and lighten it.
// The material is the lock screen clock's: clearer than the cards, the date a little frosted. The
// time as the login screen's clock format: 12 h without AM/PM (as the lock screen) or 24 h.
// GNOME's own panel clock stays, transparent (its menu still opens).

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './glass.js';

// tahoe-lockscreen/layout.js
const DIGITS = 0.12;          // the digits' height, share of the monitor's
const DIGITS_EM = 0.730;      // Space Grotesk's digit height
const DATE_TOP = 0.108;       // the top of the date's letters
const DATE_RATIO = 0.1825;    // date type size / time type size
const GAP_RATIO = 0.0827;     // gap under the date's letters / time type size
const CAP_HEIGHT = 0.741;
const FONT = 'Space Grotesk SemiBold';

// tahoe-lockscreen/glassclock.js MATERIAL, at the lock screen's size; the edge is the shared one (C)
function clockMaterial(timeSize, date) {
    const k = timeSize / 192 * (date ? 0.3 : 1);   // the date's bevel and bend: 0.3 of the time's
    const milk = date ? 0.30 : 0;                  // the date's thin strokes a little frosted
    return {
        desk: 0, frost: 0,   // the clock keeps its own glass (Phase B decides it)
        edge: 6 * k, bend: 10 * k, blur: 0, contrast: 1.0, saturation: 1.0, split: 0.05,
        rim: 0.22, rimBase: 0.08, shade: 0.04,
        light: {brightness: 0.05, milk: 0.06 + milk, tint: [0, 0, 0], tintAmount: 0},
        dark: {brightness: 0.07, milk: 0.24 + milk, tint: [0, 0, 0], tintAmount: 0},
    };
}

function fontFor(size) {
    const desc = Pango.FontDescription.from_string(FONT);
    desc.set_absolute_size(size * Pango.SCALE);
    return desc;
}

// the text's ink box, px (Pango)
function inkOf(text, size) {
    const surface = new Cairo.ImageSurface(Cairo.Format.A8, 1, 1);
    const cr = new Cairo.Context(surface);
    const layout = PangoCairo.create_layout(cr);
    layout.set_font_description(fontFor(size));
    layout.set_text(text, -1);
    const [ink] = layout.get_pixel_extents();
    cr.$dispose();
    surface.finish();
    return ink;
}

export function buildClock(ext) {
    const group = Main.screenShield?._lockDialogGroup;
    const backdrop = ext.backdrop;   // the picture's actor (nowplaying.js buildBackdrop)
    if (!group || !backdrop)
        throw new Error('no backdrop for the clock');

    const layer = new Clutter.Actor({name: 'tahoe-gdm-clock', reactive: false});
    group.add_child(layer);
    ext._undo.push(() => layer.destroy());

    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const panes = {};
    const pane = (key, material) => {
        if (panes[key])
            return panes[key];
        const shape = {text: '', size: 0, ink: null};
        const p = new GlassPane(backdrop, {
            path: (cr, x, y) => {
                const layout = PangoCairo.create_layout(cr);
                layout.set_font_description(fontFor(shape.size));
                layout.set_text(shape.text, -1);
                cr.newPath();
                cr.moveTo(x - shape.ink.x, y - shape.ink.y);
                PangoCairo.layout_path(cr, layout);
            },
        }, material);
        p.shape = shape;
        p.connect('mask-failed', () => ext._fail(`clock glass: ${p.failed}`));
        layer.add_child(p);
        panes[key] = p;
        return p;
    };

    const place = (key, text, size, top, material) => {
        const p = pane(key, material);
        const ink = inkOf(text, size);
        const changed = p.shape.text !== text || p.shape.size !== size;
        Object.assign(p.shape, {text, size, ink});
        const monitor = Main.layoutManager.primaryMonitor;
        p.set_size(ink.width, ink.height);
        p.set_position(monitor.x + Math.round((monitor.width - ink.width) / 2), monitor.y + Math.round(top));
        if (changed)
            p.reshape();
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
