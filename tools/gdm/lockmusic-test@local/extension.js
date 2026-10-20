// Workshop only (docs/GDM_PLAN.md, lock screen music mode). While something plays, on the lock
// screen:
// - the background becomes the Music widget's album-colour swirl (tahoe-widgets swirl.js' wave
//   field, the cover's colours from palette.js), cross-faded in over the picture. It is an effect
//   ON the lock background actor, so everything that copies that actor (the glass clock, the
//   glass widgets) bends the swirl too;
// - the cover sits large in the centre with the title, the artist and the transport buttons, and
//   the lock screen's own Now Playing card steps aside;
// - the widgets stack in a column on the left, as on the iPad.
// LOCKMUSIC_WIDGETS="weather-small calendar-day ..." (default weather-small calendar-day calendar-month).
// LOCKMUSIC_LAYOUT=centre (the clock stays centred at the top) | ipad (iPadOS landscape: the
// clock and date at the top left, the widget column under them, the cover larger in the middle).
// In the ipad layout the glass clock is only moved (translation), so its glass still shows the
// background from where it was: fine over the soft swirl, not exact (a real build re-aims it).
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './paneglass.js';
import {coverPalette, swirlPalette} from './palette.js';
import {WeatherSmall} from './weather.js';
import {CalendarDay, CalendarMonth} from './calendar.js';

const KINDS = {'weather-small': WeatherSmall, 'calendar-day': CalendarDay, 'calendar-month': CalendarMonth};
const FPS = 25;
const FADE = 1.2;          // s, picture to swirl
const DIM = 0.14;          // the swirl a little deeper, for the white clock and text
const COVER = 0.30;        // the cover's side, share of the height
const COLUMN_X = 0.045;    // the widget column's left edge, share of the width
const GAP = 16;

// ---- the swirl as the whole background (swirl.js' field, without a card's glass under it) ----
const DECL = `
uniform float lm_t;
uniform float lm_aspect;
uniform float lm_amount;
uniform float lm_dim;
uniform vec3 lm_c0;
uniform vec3 lm_c1;
uniform vec3 lm_c2;
uniform vec3 lm_c3;
`;
const FIELD = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec4 bg = texture2D(cogl_sampler0, uv);
    float t = lm_t;
    vec2 p = (uv - 0.5) * vec2(lm_aspect, 1.0) * 2.2;
    float ang = t * 0.04;
    float ca = cos(ang), sa = sin(ang);
    p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    p += 0.55 * vec2(sin(p.y * 1.3 + t * 0.21), cos(p.x * 1.1 - t * 0.17));
    p += 0.35 * vec2(sin(p.y * 2.1 - t * 0.15 + 1.7), cos(p.x * 1.9 + t * 0.19 + 0.6));
    p += 0.20 * vec2(sin(p.y * 3.3 + t * 0.12 + 3.1), cos(p.x * 2.9 - t * 0.14 + 2.2));
    float u = smoothstep(-0.9, 0.9, sin(p.x * 1.2 + p.y * 0.6 + t * 0.10));
    float v = smoothstep(-0.9, 0.9, sin(p.y * 1.4 - p.x * 0.5 - t * 0.08 + 1.3));
    vec3 field = mix(mix(lm_c0, lm_c1, u), mix(lm_c2, lm_c3, u), v);
    field *= 1.0 - lm_dim;
    field += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
    cogl_color_out = vec4(mix(bg.rgb, field, lm_amount), 1.0) * cogl_color_in.a;
`;

const BackgroundSwirl = GObject.registerClass(
class LockMusicBackgroundSwirl extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECL, null);
        this._snippet.set_replace(FIELD);
        this.floats = {lm_t: Math.random() * 200, lm_aspect: 16 / 9, lm_amount: 0, lm_dim: DIM};
        this.colours = swirlPalette(null);
    }

    vfunc_paint_target(node, ctx) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._lockMusic) {
            pipeline.add_snippet(this._snippet);
            pipeline._lockMusic = true;
        }
        const a = this.get_actor();
        this.floats.lm_aspect = Math.max(1, a.width) / Math.max(1, a.height);
        for (const [k, v] of Object.entries(this.floats))
            pipeline.set_uniform_1f(pipeline.get_uniform_location(k), v);
        this.colours.forEach((c, i) => pipeline.set_uniform_float(pipeline.get_uniform_location(`lm_c${i}`), 3, 1, c));
        super.vfunc_paint_target(node, ctx);
    }
});

// ---- MPRIS: the first player that is playing (test only: plain D-Bus calls) ----
async function call(bus, path, iface, method, args, type) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(bus, path, iface, method, args,
        type ? new GLib.VariantType(type) : null, 0, -1, null, (c, r) => {
            try { resolve(c.call_finish(r)); } catch (e) { reject(e); }
        }));
}

async function playing() {
    const [names] = (await call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, '(as)')).deepUnpack();
    for (const name of names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'))) {
        const get = async prop => (await call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', prop]), '(v)')).deepUnpack()[0].recursiveUnpack();
        if (await get('PlaybackStatus') !== 'Playing')
            continue;
        const meta = await get('Metadata');
        return {name, art: meta['mpris:artUrl'] ?? null, title: meta['xesam:title'] ?? '', artist: (meta['xesam:artist'] ?? []).join(', ')};
    }
    return null;
}

export default class {
    enable() {
        this._undo = [];
        this._timer = GLib.timeout_add(0, Number(GLib.getenv('LOCKMUSIC_DELAY') || 3000), () => {
            this._timer = 0;
            this._start().catch(e => console.warn(`lockmusic-test: ${e}\n${e.stack}`));
            return false;
        });
    }

    async _start() {
        // the weather location, in this throwaway shell's own settings (as widgets-test@local)
        const location = GLib.getenv('WIDGETS_TEST_LOCATION');
        if (location) {
            const settings = new Gio.Settings({schema_id: 'org.gnome.shell.weather'});
            settings.set_boolean('automatic-location', false);
            settings.set_value('locations', GLib.Variant.parse(null, location, null, null));
        }
        const track = await playing();
        if (!track)
            return;
        const dialog = Main.screenShield._dialog;
        const group = Main.screenShield._lockDialogGroup;
        const monitor = Main.layoutManager.primaryMonitor;
        const W = monitor.width, H = monitor.height;

        // 1. the swirl over the lock background
        const backgrounds = dialog._backgroundGroup.get_children();
        const effects = backgrounds.map(bg => {
            const e = new BackgroundSwirl();
            bg.add_effect_with_name('lockmusic-swirl', e);
            this._undo.push(() => bg.remove_effect(e));
            return e;
        });
        const lab = await coverPalette(track.art);
        effects.forEach(e => (e.colours = swirlPalette(lab)));
        const t0 = GLib.get_monotonic_time() / 1e6;
        this._frames = GLib.timeout_add(0, Math.round(1000 / FPS), () => {
            const now = GLib.get_monotonic_time() / 1e6;
            for (const e of effects) {
                e.floats.lm_t += 1 / FPS;
                e.floats.lm_amount = Math.min(1, (now - t0) / FADE);
                e.queue_repaint();
            }
            return true;
        });

        // 2. Now Playing's card steps aside (test: hidden); the cover in the centre
        const walk = (a, f) => { f(a); a.get_children().forEach(c => walk(c, f)); };
        walk(group, a => {
            if (a.has_style_class_name?.('tahoe-widget') && a.opacity > 0) {
                const old = a.opacity;
                a.opacity = 0;
                this._undo.push(() => (a.opacity = old));
            }
        });
        const ipad = GLib.getenv('LOCKMUSIC_LAYOUT') === 'ipad';
        const side = Math.round((ipad ? 0.38 : COVER) * H);
        const centre = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;'});
        const cover = new St.Widget({
            width: side, height: side,
            style: `background-image: url("${track.art}"); background-size: cover; border-radius: 24px;`,
        });
        centre.add_child(cover);
        const text = (t, css) => new St.Label({text: t, x_align: Clutter.ActorAlign.CENTER, style: css});
        centre.add_child(new St.Widget({height: 14}));
        centre.add_child(text(track.title, 'font-family: SF Pro Display, Adwaita Sans, sans-serif; font-size: 26px; font-weight: 700; color: #ffffff;'));
        centre.add_child(text(track.artist, 'font-family: SF Pro Text, Adwaita Sans, sans-serif; font-size: 20px; color: rgba(255, 255, 255, 0.72);'));
        const buttons = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 36px; padding-top: 14px;'});
        for (const [icon, method] of [['media-skip-backward-symbolic', 'Previous'], ['media-playback-pause-symbolic', 'PlayPause'], ['media-skip-forward-symbolic', 'Next']]) {
            const b = new St.Button({child: new St.Icon({icon_name: icon, icon_size: 30, style: 'color: #ffffff;'}), can_focus: false});
            b.connect('clicked', () => call(track.name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', method, null, null).catch(() => {}));
            buttons.add_child(b);
        }
        centre.add_child(buttons);
        group.add_child(centre);
        this._undo.push(() => centre.destroy());
        const [, natH] = centre.get_preferred_height(side);
        // between the clock (its digits end at ~26 % of the height) and the avatar (82.5 %); in the
        // ipad layout the top is free, so between the top bar and the avatar
        centre.set_position(monitor.x + Math.round((W - side) / 2), monitor.y + Math.round((ipad ? 0.42 : 0.545) * H - natH / 2));

        // the ipad layout: the clock to the top left, at the column's left edge
        let columnTop = null;
        const columnX = monitor.x + Math.round(COLUMN_X * W);
        if (ipad) {
            // tahoe-lockscreen's clock: the box spans the width, centred; the time's ink is its widest line
            let clock = null, time = null;
            walk(group, a => {
                if (a.has_style_class_name?.('tahoe-lock-clock')) clock = a;
                if (a.has_style_class_name?.('tahoe-lock-clock-time')) time = a;
            });
            if (clock && time) {
                const [, cy] = clock.get_transformed_position();
                const [ink] = time.clutter_text.get_layout().get_pixel_extents();
                const dx = columnX - Math.round(monitor.x + (W - ink.width) / 2);
                const moved = [];
                walk(group, a => {
                    if (a.name === 'tahoe-lock:clock-area' || a.name === 'tahoe-lock:glass-area') {   // frame.js prefixes its actors' names
                        moved.push(`${a.name}@${a.get_parent()?.constructor?.name}`);
                        const old = a.translation_x;
                        a.translation_x = old + dx;
                        this._undo.push(() => (a.translation_x = old));
                    }
                });
                console.warn(`lockmusic-test: clock dx ${dx} ink ${ink.width} moved ${moved.join(' ')}`);
                columnTop = Math.round(cy + clock.height + 0.03 * H);
            }
        }

        // 3. the widgets in a column on the left, on glass over the (swirling) background
        const kinds = (GLib.getenv('LOCKMUSIC_WIDGETS') ?? 'weather-small calendar-day calendar-month').split(/\s+/).filter(k => KINDS[k]);
        const total = kinds.length * 170 + (kinds.length - 1) * GAP;
        let y = columnTop ?? monitor.y + Math.round((H - total) / 2);
        const x = columnX;
        const now = GLib.DateTime.new_now_local();
        this._widgets = [];
        for (const k of kinds) {
            const card = new St.Widget({style_class: `tahoe-widget tahoe-widget-${k}`, layout_manager: new Clutter.BinLayout(), width: 170, height: 170, x, y});
            card.add_child(new GlassPane(backgrounds[0], 24));
            const content = new St.Widget({style_class: 'tahoe-widget-content', style: 'border-width: 0;', layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
            const widget = new KINDS[k]();
            content.add_child(widget.actor);
            card.add_child(content);
            group.add_child(card);
            widget.tick(now);
            this._widgets.push(widget);
            this._undo.push(() => { widget.destroy(); card.destroy(); });
            y += 170 + GAP;
        }
    }

    disable() {
        if (this._timer) GLib.source_remove(this._timer);
        if (this._frames) GLib.source_remove(this._frames);
        this._timer = this._frames = 0;
        while (this._undo?.length) {
            try { this._undo.pop()(); } catch (e) { console.warn(`lockmusic-test undo: ${e}`); }
        }
    }
}
