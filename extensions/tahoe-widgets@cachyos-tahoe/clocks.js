// Clock widgets: analog (small), digital (small) and date & time (medium).

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {scaleFactor} from './glass.js';

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

// A round clock face drawn with cairo, repainted once a second.
class AnalogFace {
    constructor(sizeLogical) {
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
        const k = Math.min(w, h) / 150;    // drawn on a 150 px face
        const {fill, ink} = FACE[this._mode] ?? FACE.milky;
        const R = Math.min(w, h) / 2;
        cr.translate(w / 2, h / 2);

        cr.arc(0, 0, R, 0, 2 * Math.PI);
        cr.setSourceRGBA(...fill);
        cr.fill();

        // minute ticks
        cr.setLineCap(Cairo.LineCap.ROUND);
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

        const now = this._now;
        if (now) {
            const s = now.get_second();
            const m = now.get_minute() + s / 60;
            const hr = (now.get_hour() % 12) + m / 60;
            const hand = (angle, length, width, tail, rgba) => {
                cr.setSourceRGBA(...rgba);
                cr.setLineWidth(width);
                cr.moveTo(-Math.sin(angle) * tail, Math.cos(angle) * tail);
                cr.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
                cr.stroke();
            };
            hand(hr * Math.PI / 6, R * 0.50, 5 * k, 0, [...ink, 1]);
            hand(m * Math.PI / 30, R * 0.76, 3.5 * k, 0, [...ink, 1]);
            cr.arc(0, 0, 4.5 * k, 0, 2 * Math.PI);
            cr.setSourceRGBA(...ink, 1);
            cr.fill();
            hand(s * Math.PI / 30, R * 0.84, 1.5 * k, 14 * k, [...ORANGE, 1]);
            cr.arc(0, 0, 2.5 * k, 0, 2 * Math.PI);
            cr.setSourceRGBA(...ORANGE, 1);
            cr.fill();
        }
        cr.$dispose();
    }

    destroy() {
        this.actor.destroy();
    }
}

export class AnalogClock {
    static size = 'small';

    constructor() {
        this._face = new AnalogFace(150);
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
