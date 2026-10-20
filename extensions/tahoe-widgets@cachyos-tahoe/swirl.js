// The Music widgets' album-colour swirl: the cover's main colours, blurred into a soft field that
// turns and drifts very slowly inside the glass, as Apple Music's full-screen lyrics background.
// The technique follows applemusic-like-lyrics' background renderer (Steve-xmh, AGPL-3.0); this
// is an original implementation, no code is taken from it.
//
// The colours come from the cover once per track (k-means on a 40 px copy), never per frame.
// The swirl is a shader over the glass (an OffscreenEffect on the card's backdrop): the glass is
// rendered once into the effect's texture, and a swirl frame only runs the shader over it again.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {RADIUS, scaleFactor} from './glass.js';

const SAMPLE = 40;      // px the cover is read at
const CLUSTERS = 5;
const KEEP = 4;         // colours the swirl uses
const CACHE_ENTRIES = 32;

// ---- colour spaces: sRGB 0..1 <-> OkLab ----

const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;

export function rgbToLab([r, g, b]) {
    [r, g, b] = [toLinear(r), toLinear(g), toLinear(b)];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

export function labToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const clamp = v => Math.min(1, Math.max(0, toSrgb(v)));
    return [
        clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}

// ---- dominant colours ----

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// k-means in OkLab over the opaque pixels (RGB or RGBA bytes); seeded deterministically
// (the mean, then the point farthest from every centre so far), so a cover always gives the
// same colours. Returns up to KEEP colours as OkLab, the most present and colourful first.
export function dominantColours(bytes, width, height, rowstride, channels) {
    // a 5-bit histogram: few distinct points, weighted by how often they occur
    const bins = new Map();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && bytes[i + 3] < 128)
                continue;
            const key = (bytes[i] >> 3) << 10 | (bytes[i + 1] >> 3) << 5 | bytes[i + 2] >> 3;
            bins.set(key, (bins.get(key) ?? 0) + 1);
        }
    }
    if (bins.size === 0)
        return null;
    const points = [], weights = [];
    for (const [key, n] of bins) {
        const rgb = [key >> 10, key >> 5 & 31, key & 31].map(v => (v * 8 + 4) / 255);
        points.push(rgbToLab(rgb));
        weights.push(n);
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const mean = [0, 1, 2].map(c => points.reduce((s, p, i) => s + p[c] * weights[i], 0) / total);
    const centres = [mean];
    const k = Math.min(CLUSTERS, points.length);
    while (centres.length < k) {
        let best = 0, far = -1;
        points.forEach((p, i) => {
            const d = Math.min(...centres.map(c => dist2(p, c)));
            if (d > far) {
                far = d;
                best = i;
            }
        });
        centres.push([...points[best]]);
    }
    const owner = new Array(points.length).fill(0);
    for (let iter = 0; iter < 12; iter++) {
        points.forEach((p, i) => {
            let bi = 0, bd = Infinity;
            centres.forEach((c, j) => {
                const d = dist2(p, c);
                if (d < bd) {
                    bd = d;
                    bi = j;
                }
            });
            owner[i] = bi;
        });
        const sums = centres.map(() => [0, 0, 0, 0]);
        points.forEach((p, i) => {
            const s = sums[owner[i]], w = weights[i];
            s[0] += p[0] * w;
            s[1] += p[1] * w;
            s[2] += p[2] * w;
            s[3] += w;
        });
        sums.forEach((s, j) => {
            if (s[3] > 0)
                centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
        });
    }
    const size = centres.map(() => 0);
    owner.forEach((o, i) => (size[o] += weights[i]));
    // present and colourful first; a chroma of 0.1 counts as much as a third of the cover more
    return centres
        .map((c, j) => ({c, share: size[j] / total}))
        .filter(x => x.share > 0.01)
        .map(x => ({...x, score: x.share ** 0.7 * (0.35 + 3 * Math.hypot(x.c[1], x.c[2]))}))
        .sort((a, b) => b.score - a.score)
        .slice(0, KEEP)
        .map(x => x.c);
}

// the palette for a cover uri (file://), cached; null when it cannot be read
const cache = new Map();

export function coverPalette(uri) {
    if (!uri)
        return Promise.resolve(null);
    if (cache.has(uri)) {
        const known = cache.get(uri);
        cache.delete(uri);   // most recent last
        cache.set(uri, known);
        return known;
    }
    const promise = new Promise(resolve => {
        const file = Gio.File.new_for_uri(uri);
        file.read_async(0, null, (f, res) => {
            let stream;
            try {
                stream = f.read_finish(res);
            } catch {
                resolve(null);
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, SAMPLE, SAMPLE, false, null, (s, r) => {
                let colours = null;
                try {
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                    colours = dominantColours(pixbuf.read_pixel_bytes().toArray(), pixbuf.get_width(),
                        pixbuf.get_height(), pixbuf.get_rowstride(), pixbuf.get_n_channels());
                } catch {}
                stream.close_async(0, null, null);
                resolve(colours);
            });
        });
    });
    cache.set(uri, promise);
    while (cache.size > CACHE_ENTRIES)
        cache.delete(cache.keys().next().value);
    promise.then(colours => {
        if (colours === null)
            cache.delete(uri);   // tried again next time (a cover still being written)
    });
    return promise;
}

// The palette as the swirl shows it in a glass mode, as 4 sRGB colours: deep under the white
// text of dark and milky glass, pale under the dark text of light glass; never neon.
// A missing cover gives a neutral grey field.
export function modePalette(colours, mode) {
    const lab = colours?.length ? colours : [[0.5, 0, 0], [0.62, 0, 0], [0.42, 0, 0], [0.55, 0, 0]];
    const [lo, hi, maxChroma] = {
        dark: [0.30, 0.50, 0.13],
        milky: [0.36, 0.56, 0.12],
        light: [0.80, 0.93, 0.09],
    }[mode] ?? [0.30, 0.50, 0.13];
    const out = [];
    for (let i = 0; i < KEEP; i++) {
        const [L, a, b] = lab[i % lab.length];
        // a short palette repeats with a little light and dark, so the field still moves
        const shift = i < lab.length ? 0 : (i % 2 ? 0.06 : -0.06);
        const C = Math.hypot(a, b);
        const f = C > maxChroma ? maxChroma / C : 1;
        out.push(labToRgb([lo + (hi - lo) * Math.min(1, Math.max(0, L + shift)), a * f, b * f]));
    }
    return out;
}

// ---- the shader ----

// Strength per glass mode: `chroma` is how far the glass takes the swirl's hue and saturation
// (keeping its own light and dark, so the rim light and edge shadow stay), `pull` how far it
// moves towards the swirl's lightness. Both fade out across the edge band.
const STRENGTH = {
    dark: {chroma: 0.80, pull: 0.42},
    milky: {chroma: 0.78, pull: 0.36},
    light: {chroma: 0.70, pull: 0.40},
};
const NEUTRAL = 0.5;      // a missing cover tints at half strength
const EDGE_BAND = 14;     // logical px at the edge where the tint fades out (the rim light's band)
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
uniform vec3 sw_c0;
uniform vec3 sw_c1;
uniform vec3 sw_c2;
uniform vec3 sw_c3;

float sw_weight(vec2 p, vec2 c) {
    vec2 d = p - c;
    return exp(-dot(d, d) * 5.0);
}
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

    // the field: four colours whose centres orbit at their own slow rates, the whole turning
    // slowly and gently warped, blended with Gaussian weights (a heavily blurred mesh)
    float t = sw_t;
    float aspect = sw_w / sw_h;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float ang = t * 0.05;
    float ca = cos(ang), sa = sin(ang);
    p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    p += 0.10 * vec2(sin(p.y * 2.7 + t * 0.23), sin(p.x * 2.3 - t * 0.19));
    vec2 k = vec2(max(aspect, 1.0) * 0.9, 1.0);
    vec2 a0 = (vec2(-0.30, -0.28) + 0.20 * vec2(cos(t * 0.130), sin(t * 0.110))) * k;
    vec2 a1 = (vec2( 0.32, -0.24) + 0.20 * vec2(cos(t * 0.090 + 2.0), sin(t * 0.120 + 1.0))) * k;
    vec2 a2 = (vec2(-0.26,  0.32) + 0.20 * vec2(cos(t * 0.110 + 4.0), sin(t * 0.080 + 3.0))) * k;
    vec2 a3 = (vec2( 0.28,  0.30) + 0.20 * vec2(cos(t * 0.070 + 1.0), sin(t * 0.100 + 5.0))) * k;
    float w0 = sw_weight(p, a0) + 0.0001, w1 = sw_weight(p, a1) + 0.0001;
    float w2 = sw_weight(p, a2) + 0.0001, w3 = sw_weight(p, a3) + 0.0001;
    vec3 field = (sw_c0 * w0 + sw_c1 * w1 + sw_c2 * w2 + sw_c3 * w3) / (w0 + w1 + w2 + w3);
    // a dither against banding in the slow gradients
    field += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

    // full strength inside, fading out across the edge band (rounded rectangle distance)
    vec2 px = uv * vec2(sw_w, sw_h);
    vec2 q = abs(px - 0.5 * vec2(sw_w, sw_h)) - (0.5 * vec2(sw_w, sw_h) - sw_radius);
    float inside = sw_radius - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
    float fade = smoothstep(0.0, sw_band, inside);

    // the swirl's colour at the glass's own lightness, then a pull towards the swirl's lightness
    vec3 hue = clamp(field + (sw_luma(g) - sw_luma(field)), 0.0, 1.0);
    vec3 c = mix(g, hue, sw_chroma * mix(0.35, 1.0, fade));
    c = mix(c, field, sw_pull * fade);
    cogl_color_out = vec4(c * glass.a, glass.a) * cogl_color_in.a;
`;

const SwirlEffect = GObject.registerClass(
class SwirlEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
        this._floats = {sw_w: 1, sw_h: 1, sw_radius: 0, sw_band: 1, sw_t: 0, sw_chroma: 0, sw_pull: 0};
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
// locked, and animations on. Anything else holds a still frame and runs no timer at all.
export class Swirl {
    constructor() {
        this._effect = new SwirlEffect();
        this._card = null;
        this._mode = 'dark';
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

    setMode(mode) {
        this._mode = mode in STRENGTH ? mode : 'dark';
        this._from = this._to = modePalette(this._lab, this._mode);
        this._fade = 1;
        this._show();
    }

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
            this._to = modePalette(lab, this._mode);
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
        if (!actor?.mapped || Main.sessionMode.isLocked)
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
            return this._to ?? modePalette(this._lab, this._mode);
        const f = this._fade * this._fade * (3 - 2 * this._fade);
        return this._to.map((c, i) => c.map((v, j) => this._from[i][j] + (v - this._from[i][j]) * f));
    }

    _show() {
        if (!this._to)
            this._from = this._to = modePalette(this._lab, this._mode);
        const {chroma, pull} = STRENGTH[this._mode];
        const k = this._lab ? 1 : NEUTRAL;
        this._effect.set({sw_t: this._t, sw_chroma: chroma * k, sw_pull: pull * k}, this._current());
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
