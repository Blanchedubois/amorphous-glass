// The Music widgets' album-colour swirl: the cover's main colours, blurred into a soft field that
// turns and drifts very slowly inside the glass, as Apple Music's full-screen lyrics background.
// The technique follows applemusic-like-lyrics' background renderer (Steve-xmh, AGPL-3.0); this
// is an original implementation, no code is taken from it. The field is waves, not blobs (user,
// 2026-10-20): a sine domain warp that folds bands of the cover's colours into slow ribbons.
//
// The colours come from the cover once per track (palette.js), never per frame.
// The swirl is a shader over the glass (an OffscreenEffect on the card's backdrop): the glass is
// rendered once into the effect's texture, and a swirl frame only runs the shader over it again.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {RADIUS, scaleFactor} from './glass.js';

import {coverPalette, swirlPalette, wantsDarkInk} from './palette.js';

// ---- the shader ----

// `chroma`: how far the glass takes the swirl's hue and saturation (keeping its own light and
// dark, so the rim light and edge shadow stay); `pull`: how far it moves on to the swirl's own
// colour. The same in every mode, low enough that the wallpaper still shows through.
const CHROMA = 0.70;
const PULL = 0.38;
const NEUTRAL = 0.5;      // a missing cover tints at half strength
const EDGE_BAND = 14;     // logical px at the edge where only the glass's highlights are kept
const SPEED = 1.0;        // the swirl's clock against real time
const FPS = 25;           // slow motion: 25 frames a second is plenty, at any refresh rate
const FADE = 1.2;         // s, the cross-fade to a new track's colours

// layer 0 is the glass (the offscreen copy of the backdrop, premultiplied)
const DECLARATIONS = `
uniform float sw_w;
uniform float sw_h;
uniform float sw_radius;
uniform float sw_band;
uniform float sw_t;
uniform float sw_chroma;
uniform float sw_pull;
uniform float sw_ink;
uniform vec3 sw_c0;
uniform vec3 sw_c1;
uniform vec3 sw_c2;
uniform vec3 sw_c3;

float sw_luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
`;
const SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec4 glass = texture2D(cogl_sampler0, uv);
    if (glass.a < 0.004) {
        cogl_color_out = glass * cogl_color_in.a;
        return;
    }
    vec3 g = glass.rgb / glass.a;

    // the field: waves, as Apple Music's. The plane is folded by a few sine warps, each feeding
    // the next (a domain warp), so straight bands become long ribbons that roll and fold slowly;
    // two smooth waves over the warped plane mix the four cover colours, the whole turning slowly
    float t = sw_t;
    float aspect = sw_w / sw_h;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.2;
    float ang = t * 0.04;
    float ca = cos(ang), sa = sin(ang);
    p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    p += 0.55 * vec2(sin(p.y * 1.3 + t * 0.21), cos(p.x * 1.1 - t * 0.17));
    p += 0.35 * vec2(sin(p.y * 2.1 - t * 0.15 + 1.7), cos(p.x * 1.9 + t * 0.19 + 0.6));
    p += 0.20 * vec2(sin(p.y * 3.3 + t * 0.12 + 3.1), cos(p.x * 2.9 - t * 0.14 + 2.2));
    float u = smoothstep(-0.9, 0.9, sin(p.x * 1.2 + p.y * 0.6 + t * 0.10));
    float v = smoothstep(-0.9, 0.9, sin(p.y * 1.4 - p.x * 0.5 - t * 0.08 + 1.3));
    vec3 field = mix(mix(sw_c0, sw_c1, u), mix(sw_c2, sw_c3, u), v);
    // a light scrim for the text: a little deeper under white text, a little paler under dark
    field = sw_ink < 0.0 ? field * (1.0 + 0.20 * sw_ink) : mix(field, vec3(1.0), 0.20 * sw_ink);
    // a dither against banding in the slow gradients
    field += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

    // At the edge Blur My Shell's glass has a lit rim, an inner shadow and a refraction band.
    // Only the light is kept (user, 2026-10-20: highlights, no 3D emboss): across the band the
    // glass is read from just inside it, and whatever is brighter at the edge is added back.
    vec2 size = vec2(sw_w, sw_h);
    vec2 px = uv * size;
    vec2 q = abs(px - 0.5 * size) - (0.5 * size - sw_radius);
    float inside = sw_radius - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
    vec3 base = g;
    if (inside < sw_band) {
        // inwards, away from the nearest edge
        vec2 out_ = q.x > 0.0 && q.y > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        vec2 inward = -out_ * sign(px - 0.5 * size);
        vec4 deep = texture2D(cogl_sampler0, uv + inward * (sw_band - inside + 2.0) / size);
        base = mix(deep.a > 0.004 ? deep.rgb / deep.a : g, g, smoothstep(0.0, sw_band, inside));
    }
    float light = max(sw_luma(g) - sw_luma(base), 0.0);

    // the swirl's colour at the glass's own lightness, then a pull towards the swirl's own colour
    vec3 hue = clamp(field + (sw_luma(base) - sw_luma(field)), 0.0, 1.0);
    vec3 c = mix(base, hue, sw_chroma);
    c = mix(c, field, sw_pull);
    c = min(c + light, vec3(1.0));
    cogl_color_out = vec4(c * glass.a, glass.a) * cogl_color_in.a;
`;

const SwirlEffect = GObject.registerClass(
class SwirlEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
        this._floats = {sw_w: 1, sw_h: 1, sw_radius: 0, sw_band: 1, sw_t: 0, sw_chroma: 0, sw_pull: 0, sw_ink: 0};
        this._colours = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    }

    set(floats, colours) {
        Object.assign(this._floats, floats);
        if (colours)
            this._colours = colours;
        // only the shader runs again, over the glass already rendered
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        // no glass under it (no Blur My Shell): nothing to tint
        if (!pipeline || this.get_actor().get_n_children() === 0)
            return;
        if (!pipeline._tahoeSwirl) {
            pipeline.add_snippet(this._snippet);
            pipeline._tahoeSwirl = true;
        }
        const scale = scaleFactor();
        const actor = this.get_actor();
        Object.assign(this._floats, {
            sw_w: Math.max(1, actor.width), sw_h: Math.max(1, actor.height),
            sw_radius: RADIUS * scale, sw_band: EDGE_BAND * scale,
        });
        for (const [name, value] of Object.entries(this._floats))
            pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
        this._colours.forEach((c, i) =>
            pipeline.set_uniform_float(pipeline.get_uniform_location(`sw_c${i}`), 3, 1, c));
        super.vfunc_paint_target(node, paintContext);
    }
});

// ---- one frame source for every swirl ----

const running = new Set();
let frameId = 0;

function startFrames(swirl) {
    running.add(swirl);
    frameId ||= GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / FPS), () => {
        const now = GLib.get_monotonic_time() / 1e6;
        for (const s of [...running])
            s._frame(now);
        if (running.size > 0)
            return GLib.SOURCE_CONTINUE;
        frameId = 0;
        return GLib.SOURCE_REMOVE;
    });
}

function stopFrames(swirl) {
    running.delete(swirl);
    if (running.size === 0 && frameId) {
        GLib.source_remove(frameId);
        frameId = 0;
    }
}

export function swirlFramesRunning() {
    return running.size;
}

// ---- a widget's swirl ----

// Frames run only while there is something to show moving: playing (or a cross-fade under way),
// the card mapped, its monitor not under a fullscreen window and no window covering it, not
// locked (unless built for the lock screen, where its gate decides), and animations on. Anything
// else holds a still frame and runs no timer at all.
export class Swirl {
    // lockScreen: the swirl may run while the screen is locked (the lock screen's Music widget);
    // there no window can cover it, and gate() (if given) decides instead
    constructor({lockScreen = false, gate = null} = {}) {
        this._lockScreen = lockScreen;
        this._gate = gate;
        this._effect = new SwirlEffect();
        this._card = null;
        this._ink = null;
        this._inkFrom = 0;
        this.onInk = null;          // (dark) true: dark text, false: white, null: as the glass mode
        this._lab = null;           // the cover's colours (OkLab), null: neutral
        this._from = null;          // sRGB palettes, for the cross-fade
        this._to = null;
        this._fade = 1;
        this._t = Math.random() * 200;   // each widget starts at its own point of the motion
        this._last = 0;
        this._playing = false;
        this._uri = undefined;
        this._serial = 0;
        this._settings = St.Settings.get();
        this._settings.connectObject('notify::enable-animations', () => this.check(), this);
        global.display.connectObject(
            'in-fullscreen-changed', () => this.check(),
            'restacked', () => this.check(), this);
        Main.sessionMode.connectObject('updated', () => this.check(), this);
        this._show();
    }

    attachCard(card) {
        this._card = card;
        card.addBackdropEffect('tahoe-music-swirl', this._effect);
        card.actor.connectObject('notify::mapped', () => this.check(), this);
        this.check();
    }

    // the swirl is the cover's colours in every glass mode
    setMode() {}

    setPlaying(playing) {
        this._playing = playing;
        this.check();
    }

    // a new cover (a file uri, or null for none): its colours are read once, then cross-faded to
    setCover(uri) {
        if (uri === this._uri)
            return;
        this._uri = uri;
        const serial = ++this._serial;
        coverPalette(uri).then(lab => {
            if (serial !== this._serial || !this._effect)
                return;
            this._lab = lab;
            this._from = this._current();
            this._to = swirlPalette(lab);
            this._inkFrom = this._inkValue();
            this._ink = this._lab ? wantsDarkInk(this._to) : null;
            this.onInk?.(this._ink);
            this._fade = this._animating() ? 0 : 1;
            this._show();
            this.check();
        });
    }

    _animating() {
        return this._settings.enable_animations && this._visible();
    }

    _visible() {
        const actor = this._card?.actor;
        if (!actor?.mapped)
            return false;
        if (this._lockScreen)
            return this._gate?.() ?? true;
        if (Main.sessionMode.isLocked)
            return false;
        const monitor = Main.layoutManager.monitors[this._card.monitorIndex];
        if (!monitor || monitor.inFullscreen)
            return false;
        // a window over the whole card (a maximised one, say) hides it as well
        const [x, y] = actor.get_transformed_position();
        const w = actor.width, h = actor.height;
        const workspace = global.workspace_manager.get_active_workspace();
        return !global.get_window_actors().some(a => {
            const win = a.meta_window;
            if (!a.visible || win.minimized || win.get_window_type() !== Meta.WindowType.NORMAL || !win.located_on_workspace(workspace) || a.opacity < 255)
                return false;
            const r = win.get_frame_rect();
            return r.x <= x && r.y <= y && r.x + r.width >= x + w && r.y + r.height >= y + h;
        });
    }

    // start or stop the frames; the widget calls this once a second while playing as well
    check() {
        if (!this._effect)
            return;
        const want = this._card && this._animating() && (this._playing || this._fade < 1);
        if (want && !running.has(this)) {
            this._last = GLib.get_monotonic_time() / 1e6;
            startFrames(this);
        } else if (!want && running.has(this)) {
            stopFrames(this);
            if (this._fade < 1) {   // a cross-fade cut short ends on the new colours
                this._fade = 1;
                this._show();
            }
        }
    }

    _frame(now) {
        const dt = Math.min(0.2, Math.max(0, now - this._last));
        this._last = now;
        if (this._playing)
            this._t = (this._t + dt * SPEED) % 10000;
        if (this._fade < 1)
            this._fade = Math.min(1, this._fade + dt / FADE);
        this._show();
        if (!this._playing && this._fade >= 1)
            this.check();
    }

    _current() {
        if (!this._from || !this._to)
            return this._to ?? swirlPalette(this._lab);
        const f = this._fade * this._fade * (3 - 2 * this._fade);
        return this._to.map((c, i) => c.map((v, j) => this._from[i][j] + (v - this._from[i][j]) * f));
    }

    // the scrim follows the cross-fade too
    _inkValue() {
        const to = this._ink === null ? 0 : this._ink ? 1 : -1;
        return this._inkFrom + (to - this._inkFrom) * Math.min(1, this._fade);
    }

    _show() {
        if (!this._to)
            this._from = this._to = swirlPalette(this._lab);
        const k = this._lab ? 1 : NEUTRAL;
        this._effect.set({sw_t: this._t, sw_chroma: CHROMA * k, sw_pull: PULL * k,
            sw_ink: this._inkValue()}, this._current());
    }

    destroy() {
        stopFrames(this);
        this._serial++;
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._card?.actor.disconnectObject(this);
        this._card = null;
        this._effect = null;
    }
}
