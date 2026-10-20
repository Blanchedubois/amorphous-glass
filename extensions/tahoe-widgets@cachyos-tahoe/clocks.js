// Clock widgets: three analog faces (small), digital (small) and date & time (medium).
// Clock II and Clock III follow the faces of jaxparrow07/liquidglass-kde-widgets (GPL-3.0),
// redrawn here with cairo; no code or assets are taken from it.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {RADIUS, scaleFactor} from './glass.js';

const ORANGE = [1.0, 0.584, 0.0];  // macOS second hand
// face fill and ink per glass mode: dark ink on light glass, white elsewhere
const FACE = {
    light: {fill: [1, 1, 1, 0.72], ink: [0.11, 0.11, 0.118]},
    dark: {fill: [0, 0, 0, 0.28], ink: [1, 1, 1]},
    milky: {fill: [1, 1, 1, 0.10], ink: [1, 1, 1]},
};

// Apple's SF Pro, as on Tahoe (the user's own download, in ~/.local/share/fonts/SF-Pro);
// fontconfig falls back to the system font where it is missing
const FACE_FONT = 'SF Pro Rounded Semibold';

const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

export function use24h() {
    return interfaceSettings.get_string('clock-format') !== '12h';
}

// time text and its AM/PM suffix ('' in 24-hour mode)
export function timeParts(now) {
    if (use24h())
        return [now.format('%H:%M'), ''];
    return [now.format('%l:%M').trim(), now.format('%p')];
}

// rounded box of half size hw x hh and corner r: how far along the unit ray (dx, dy) its edge is
function roundedBoxHit(dx, dy, hw, hh, r) {
    const inside = t => {
        const qx = Math.abs(t * dx) - hw + r, qy = Math.abs(t * dy) - hh + r;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r <= 0;
    };
    let lo = 0, hi = Math.hypot(hw, hh);
    for (let i = 0; i < 24; i++) {
        const t = (lo + hi) / 2;
        if (inside(t))
            lo = t;
        else
            hi = t;
    }
    return lo;
}

// A clock face drawn with cairo, repainted once a second. Styles:
//   numbers   every hour numbered on a round face (Clock I)
//   marks     twelve pill marks, no numerals (Clock II)
//   quarters  12, 3, 6 and 9, with minute ticks that trace the widget's rounded edge (Clock III);
//             it fills the whole card, the glass is its face
class AnalogFace {
    constructor(sizeLogical, style = 'numbers') {
        this._style = style;
        this._mode = 'milky';
        this._now = null;
        this.actor = new St.DrawingArea({
            style_class: 'tahoe-clock-face',
            width: sizeLogical * scaleFactor(),
            height: sizeLogical * scaleFactor(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.connect('repaint', area => this._draw(area));
    }

    setMode(mode) {
        this._mode = mode;
        this.actor.queue_repaint();
    }

    tick(now) {
        this._now = now;
        this.actor.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const {fill, ink} = FACE[this._mode] ?? FACE.milky;
        const R = Math.min(w, h) / 2;
        cr.translate(w / 2, h / 2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        if (this._style === 'quarters')
            this._drawQuarters(cr, w, h, ink);
        else
            this._drawRound(cr, R, fill, ink);
        if (this._now) {
            if (this._style === 'numbers')
                this._drawHands(cr, R, ink);
            else
                this._drawPillHands(cr, this._style === 'quarters' ? R * 0.84 : R, ink);
        }
        cr.$dispose();
    }

    _drawRound(cr, R, fill, ink) {
        const k = R / 75;    // drawn on a 150 px face
        cr.arc(0, 0, R, 0, 2 * Math.PI);
        cr.setSourceRGBA(...fill);
        cr.fill();

        if (this._style === 'marks') {
            // twelve pills at the rim
            cr.setSourceRGBA(...ink, 0.75);
            cr.setLineWidth(5.2 * k);
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6;
                const r0 = R - 6 * k, r1 = R - 18 * k;
                cr.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
                cr.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
                cr.stroke();
            }
            return;
        }

        // minute ticks
        for (let i = 0; i < 60; i++) {
            if (i % 5 === 0)
                continue;
            const a = i * Math.PI / 30;
            cr.setSourceRGBA(...ink, 0.35);
            cr.setLineWidth(1 * k);
            cr.moveTo(Math.sin(a) * (R - 5 * k), -Math.cos(a) * (R - 5 * k));
            cr.lineTo(Math.sin(a) * (R - 8 * k), -Math.cos(a) * (R - 8 * k));
            cr.stroke();
        }

        // hour numerals, centred on their ink
        const layout = PangoCairo.create_layout(cr);
        const font = Pango.FontDescription.from_string(FACE_FONT);
        font.set_absolute_size(16 * k * Pango.SCALE);
        layout.set_font_description(font);
        cr.setSourceRGBA(...ink, 1);
        for (let hour = 1; hour <= 12; hour++) {
            const a = hour * Math.PI / 6;
            layout.set_text(String(hour), -1);
            const [ink_rect] = layout.get_pixel_extents();
            const cx = Math.sin(a) * (R - 18 * k);
            const cy = -Math.cos(a) * (R - 18 * k);
            cr.moveTo(cx - ink_rect.x - ink_rect.width / 2, cy - ink_rect.y - ink_rect.height / 2);
            PangoCairo.show_layout(cr, layout);
        }
    }

    // Clock III: 60 ticks from just inside the card's rounded edge; the hour ticks run in to a
    // circle, the numerals sit inside it
    _drawQuarters(cr, w, h, ink) {
        const side = Math.min(w, h);
        const R = side / 2;
        const scale = scaleFactor();
        const inset = 0.05 * side, len = 0.026 * side;
        const corner = (RADIUS - 1) * scale;   // the rim's inner edge
        const hourR = 0.70 * R;
        if (this._ticksFor !== `${w}x${h}`) {
            this._ticksFor = `${w}x${h}`;
            this._ticks = [];
            for (let i = 0; i < 60; i++) {
                const a = i * Math.PI / 30;
                const dx = Math.sin(a), dy = -Math.cos(a);
                // the corners lean out a little so the ticks follow the edge evenly
                const blend = 1 - Math.abs(Math.abs(dx) - Math.abs(dy));
                const o = inset - 0.012 * side * blend;
                const outer = roundedBoxHit(dx, dy, w / 2 - o, h / 2 - o, Math.max(0, corner - o));
                const inner = i % 5 === 0 ? hourR
                    : roundedBoxHit(dx, dy, w / 2 - inset - len, h / 2 - inset - len, Math.max(0, corner - inset - len));
                this._ticks.push([dx, dy, outer, inner]);
            }
        }
        this._ticks.forEach(([dx, dy, outer, inner], i) => {
            const hour = i % 5 === 0;
            cr.setSourceRGBA(...ink, hour ? 0.5 : 0.3);
            cr.setLineWidth((hour ? 2.9 : 2.2) * scale);
            cr.moveTo(dx * outer, dy * outer);
            cr.lineTo(dx * inner, dy * inner);
            cr.stroke();
        });

        const layout = PangoCairo.create_layout(cr);
        const font = Pango.FontDescription.from_string(FACE_FONT);
        font.set_absolute_size(0.238 * 0.84 * R * Pango.SCALE);
        layout.set_font_description(font);
        cr.setSourceRGBA(...ink, 1);
        for (const hour of [12, 3, 6, 9]) {
            const a = hour * Math.PI / 6;
            layout.set_text(String(hour), -1);
            const [ink_rect] = layout.get_pixel_extents();
            // 12 and 6 sit a little deeper, so each numeral has the same gap to its line
            const d = hourR - (hour % 6 === 0 ? 0.17 : 0.13) * R;
            const cx = Math.sin(a) * d, cy = -Math.cos(a) * d;
            cr.moveTo(cx - ink_rect.x - ink_rect.width / 2, cy - ink_rect.y - ink_rect.height / 2);
            PangoCairo.show_layout(cr, layout);
        }
    }

    _time() {
        const now = this._now;
        const s = now.get_second();
        const m = now.get_minute() + s / 60;
        const hr = (now.get_hour() % 12) + m / 60;
        return [hr * Math.PI / 6, m * Math.PI / 30, s * Math.PI / 30];
    }

    _drawHands(cr, R, ink) {
        const k = R / 75;
        const [ha, ma, sa] = this._time();
        const hand = (angle, length, width, tail, rgba) => {
            cr.setSourceRGBA(...rgba);
            cr.setLineWidth(width);
            cr.moveTo(-Math.sin(angle) * tail, Math.cos(angle) * tail);
            cr.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
            cr.stroke();
        };
        hand(ha, R * 0.50, 5 * k, 0, [...ink, 1]);
        hand(ma, R * 0.76, 3.5 * k, 0, [...ink, 1]);
        cr.arc(0, 0, 4.5 * k, 0, 2 * Math.PI);
        cr.setSourceRGBA(...ink, 1);
        cr.fill();
        hand(sa, R * 0.84, 1.5 * k, 14 * k, [...ORANGE, 1]);
        cr.arc(0, 0, 2.5 * k, 0, 2 * Math.PI);
        cr.setSourceRGBA(...ORANGE, 1);
        cr.fill();
    }

    // Tahoe's newer hands: a thin stem from the centre, then a rounded pill
    _drawPillHands(cr, r, ink) {
        const [ha, ma, sa] = this._time();
        const minuteLen = r * 0.86, hourLen = minuteLen * 0.65;
        const stem = r * 0.15;
        const pill = (angle, length) => {
            const dx = Math.sin(angle), dy = -Math.cos(angle);
            cr.setLineCap(Cairo.LineCap.BUTT);
            cr.setLineWidth(r * 0.0336);
            cr.moveTo(0, 0);
            cr.lineTo(dx * stem, dy * stem);
            cr.stroke();
            const w = r * 0.065;
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(w);
            cr.moveTo(dx * (stem + w / 2), dy * (stem + w / 2));
            cr.lineTo(dx * (length - w / 2), dy * (length - w / 2));
            cr.stroke();
        };
        cr.setSourceRGBA(...ink, 1);
        pill(ha, hourLen);
        pill(ma, minuteLen);
        cr.arc(0, 0, r * 0.05, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(...ORANGE, 1);
        cr.setLineCap(Cairo.LineCap.BUTT);
        cr.setLineWidth(r * 0.018);
        const sl = this._style === 'quarters' ? r * 1.07 : r * 0.9;
        cr.moveTo(-Math.sin(sa) * r * 0.15, Math.cos(sa) * r * 0.15);
        cr.lineTo(Math.sin(sa) * sl, -Math.cos(sa) * sl);
        cr.stroke();
        cr.arc(0, 0, r * 0.03, 0, 2 * Math.PI);
        cr.fill();
    }

    destroy() {
        this.actor.destroy();
    }
}

export class AnalogClock {
    static size = 'small';
    static faceStyle = 'numbers';
    static faceSize = 150;

    constructor() {
        this._face = new AnalogFace(this.constructor.faceSize, this.constructor.faceStyle);
        this.actor = this._face.actor;
    }

    setMode(mode) {
        this._face.setMode(mode);
    }

    tick(now) {
        this._face.tick(now);
    }

    destroy() {
        this._face.destroy();
    }
}

export class AnalogMarksClock extends AnalogClock {
    static faceStyle = 'marks';
}

// fills the whole card (no padding): the ticks trace its rounded edge
export class AnalogQuartersClock extends AnalogClock {
    static faceStyle = 'quarters';
    static faceSize = 168;   // inside the 1 px rim
}

// weekday and day in red caps, the time below it
export class DigitalClock {
    static size = 'small';

    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-clock-digital',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._date = new St.Label({style_class: 'tahoe-widget-accent'});
        const row = new St.BoxLayout({style_class: 'tahoe-clock-row'});
        this._time = new St.Label({style_class: 'tahoe-clock-time', y_align: Clutter.ActorAlign.END});
        this._ampm = new St.Label({style_class: 'tahoe-clock-ampm', y_align: Clutter.ActorAlign.END});
        row.add_child(this._time);
        row.add_child(this._ampm);
        this._place = new St.Label({style_class: 'tahoe-widget-secondary', text: 'Local'});
        this.actor.add_child(this._date);
        this.actor.add_child(row);
        this.actor.add_child(new St.Widget({y_expand: true}));
        this.actor.add_child(this._place);
    }

    setMode() {}

    tick(now) {
        const [time, ampm] = timeParts(now);
        this._time.text = time;
        this._ampm.text = ampm;
        this._date.text = now.format('%A %e').replace(/\s+/g, ' ').toUpperCase();
    }

    destroy() {
        this.actor.destroy();
    }
}

// medium: the digital time and date beside an analog face
export class DateTimeClock {
    static size = 'medium';

    constructor() {
        this.actor = new St.BoxLayout({style_class: 'tahoe-clock-datetime', x_expand: true, y_expand: true});
        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._weekday = new St.Label({style_class: 'tahoe-widget-accent'});
        const row = new St.BoxLayout({style_class: 'tahoe-clock-row'});
        this._time = new St.Label({style_class: 'tahoe-clock-time tahoe-clock-time-large', y_align: Clutter.ActorAlign.END});
        this._ampm = new St.Label({style_class: 'tahoe-clock-ampm', y_align: Clutter.ActorAlign.END});
        row.add_child(this._time);
        row.add_child(this._ampm);
        this._date = new St.Label({style_class: 'tahoe-widget-secondary'});
        text.add_child(this._weekday);
        text.add_child(row);
        text.add_child(new St.Widget({y_expand: true}));
        text.add_child(this._date);
        this.actor.add_child(text);
        this._face = new AnalogFace(130);
        this.actor.add_child(this._face.actor);
    }

    setMode(mode) {
        this._face.setMode(mode);
    }

    tick(now) {
        const [time, ampm] = timeParts(now);
        this._time.text = time;
        this._ampm.text = ampm;
        this._weekday.text = now.format('%A').toUpperCase();
        this._date.text = now.format('%B %e, %Y').replace(/\s+/g, ' ');
        this._face.tick(now);
    }

    destroy() {
        this._face.destroy();
        this.actor.destroy();
    }
}
