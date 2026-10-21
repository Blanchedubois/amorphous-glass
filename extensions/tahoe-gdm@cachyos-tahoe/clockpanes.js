// The clock's glass, shared by both screens (the login screen's clock.js, and the lock screen as an
// exact copy, tools/lockscreen/shared.list): the date and the time each a glass pane shaped like
// its glyphs, in Space Grotesk SemiBold, centred in a layer, in the clock's glass (the user's pick,
// 2026-10-20: B2 clear blur, docs/GLASS_CONSISTENCY_PLAN.md Phase B). The caller places them (its
// own sizes and positions) and gives its glass module, so the copy works in either extension.

import Cairo from 'cairo';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

export const FONT = 'Space Grotesk SemiBold';

// B1 dark glass: the cards' frosted dark glass on the glyphs. B2 clear blur: the picture blurred
// through the digits, a little lighter, no tint, only the hairline. The test shells may try
// another (TAHOE_CLOCK_VARIANT=B1|B2|old: the clear glass before Phase B).
export const CLOCK_VARIANTS = {
    B1: {
        desk: 1, frost: 18, bend: 0, blur: 0, edge: 6, contrast: 1, saturation: 1, split: 0,
        rimLight: 0.55, rimLightWidth: 0.45, ao: 0.3, aoWidth: 0.2, shadow: 0, band: 8,
        hairAlpha: {light: 0.16, dark: 0.16},
        light: {brightness: 0, milk: 0, tint: [34 / 255, 34 / 255, 38 / 255], tintAmount: 0.42},
        dark: {brightness: 0, milk: 0, tint: [34 / 255, 34 / 255, 38 / 255], tintAmount: 0.42},
    },
    B2: {
        desk: 1, frost: 18, bend: 0, blur: 0, edge: 6, contrast: 1, saturation: 1.1, split: 0,
        rimLight: 0.35, rimLightWidth: 0.45, ao: 0, aoWidth: 0.2, shadow: 0, band: 8,
        hairAlpha: {light: 0.16, dark: 0.16},
        light: {brightness: 0.10, milk: 0.10, tint: [1, 1, 1], tintAmount: 0},
        dark: {brightness: 0.10, milk: 0.10, tint: [1, 1, 1], tintAmount: 0},
    },
};
const VARIANT = GLib.getenv('TAHOE_CLOCK_VARIANT') || 'B2';

// the clear glass before Phase B (tahoe-lockscreen glassclock.js MATERIAL at the lock screen's
// size), kept for the test shells' comparisons
function oldMaterial(timeSize, date) {
    const k = timeSize / 192 * (date ? 0.3 : 1);
    const milk = date ? 0.30 : 0;
    return {
        desk: 0, frost: 0,
        edge: 6 * k, bend: 10 * k, blur: 0, contrast: 1.0, saturation: 1.0, split: 0.05,
        rim: 0.22, rimBase: 0.08, shade: 0.04,
        light: {brightness: 0.05, milk: 0.06 + milk, tint: [0, 0, 0], tintAmount: 0},
        dark: {brightness: 0.07, milk: 0.24 + milk, tint: [0, 0, 0], tintAmount: 0},
    };
}

export function clockMaterial(timeSize, date) {
    return CLOCK_VARIANTS[VARIANT] ?? oldMaterial(timeSize, date);
}

function fontFor(size) {
    const desc = Pango.FontDescription.from_string(FONT);
    desc.set_absolute_size(size * Pango.SCALE);
    return desc;
}

// the text's ink box, px (Pango)
export function inkOf(text, size) {
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

export class ClockPanes {
    // layer: the actor the panes go in; backdrop: as GlassPane's; GlassPane: the caller's glass
    // module's; onFail(reason): a pane's shape could not be made
    constructor(layer, backdrop, GlassPane, onFail) {
        this._layer = layer;
        this._backdrop = backdrop;
        this._GlassPane = GlassPane;
        this._onFail = onFail;
        this._panes = {};
        this._onPaint = null;
    }

    _pane(key, material) {
        if (this._panes[key])
            return this._panes[key];
        const shape = {text: '', size: 0, ink: null};
        const pane = new this._GlassPane(this._backdrop, {
            path: (cr, x, y) => {
                const layout = PangoCairo.create_layout(cr);
                layout.set_font_description(fontFor(shape.size));
                layout.set_text(shape.text, -1);
                cr.newPath();
                cr.moveTo(x - shape.ink.x, y - shape.ink.y);
                PangoCairo.layout_path(cr, layout);
            },
        }, material);
        pane.shape = shape;
        pane.connect('mask-failed', () => this._onFail?.(`${pane.failed}`));
        if (this._onPaint)
            pane.effect.onPaint = this._firstPaint();
        this._layer.add_child(pane);
        this._panes[key] = pane;
        return pane;
    }

    // one line: text at size (px), its letters' top at top, centred between left and left + width
    place(key, text, size, top, left, width, material) {
        const pane = this._pane(key, material);
        const ink = inkOf(text, size);
        const changed = pane.shape.text !== text || pane.shape.size !== size;
        Object.assign(pane.shape, {text, size, ink});
        pane.set_size(ink.width, ink.height);
        pane.set_position(Math.round(left + (width - ink.width) / 2), Math.round(top));
        if (changed)
            pane.reshape();
    }

    get paints() {
        return Object.values(this._panes).reduce((n, pane) => n + (pane.effect.paints ?? 0), 0);
    }

    // fn runs once, after the first paint of any pane
    set onPaint(fn) {
        this._onPaint = fn;
        for (const pane of Object.values(this._panes))
            pane.effect.onPaint = fn ? this._firstPaint() : null;
    }

    _firstPaint() {
        return () => {
            const fn = this._onPaint;
            this._onPaint = null;
            for (const pane of Object.values(this._panes))
                pane.effect.onPaint = null;
            fn?.();
        };
    }

    destroy() {
        for (const pane of Object.values(this._panes))
            pane.destroy();
        this._panes = {};
    }
}
