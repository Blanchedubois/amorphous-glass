// Now Playing on the lock screen (docs/LOCKSCREEN_PLAN.md, Phase 5).
//
// The card is GNOME's own lock screen media card (MessageList.MediaMessage in the unlock dialog's
// notifications box): its title, artist, cover and three buttons, its rule that a click never
// opens the player while locked, and its per-app "Show on lock screen" switch (Settings >
// Notifications) all stay GNOME's. There is no player code here and nothing goes on the network.
//
// What this adds, through the frame (frame.js):
// - glass under each card: a clone of GNOME's own lock picture, cropped to the card and rounded,
//   in our own layer below GNOME's dialog contents, so it can never cover or take a click;
// - the album-colour swirl of the desktop Music widgets (tahoe-widgets/swirl.js, same idea and
//   shader; its colours from palette.js, a copy of the widgets' module): the cover's colours,
//   read once per track from a local file only, folded into slow ribbons over the glass. It runs
//   (25 frames a second) only while the track plays, animations are on, the screen is not dimming
//   and there was input in the last 30 s (Mutter 51 has no readable monitor power state, and a
//   screen gone dark is an idle one); otherwise it holds a still frame and no timer runs;
// - dark text on light covers, as the Music widgets do.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {coverPalette, swirlPalette, wantsDarkInk} from './palette.js';

const RADIUS = 24;        // tokens/radius.json: widget
const CHROMA = 0.70;      // as the Music widgets' swirl
const PULL = 0.38;
const NEUTRAL = 0.5;      // no (local) cover: a neutral field at half strength
const SPEED = 1.0;
const FPS = 25;
const FADE = 1.2;         // s, cross-fade to a new track's colours
const EDGE = 0.16;        // the 1 px edge line, white (tokens/glass.json, dark)
const INK_DARK = 'tahoe-lock-ink-dark';
const IDLE_STOP = 30;     // s without input on the lock screen before the swirl holds still

// shared by every card of the dialog: whether the user has been idle for IDLE_STOP
const idle = {idle: false};

// layer 0: the lock picture under the card (the clone, rendered once into the offscreen texture)
const DECLARATIONS = `
uniform float sw_w;
uniform float sw_h;
uniform float sw_radius;
uniform float sw_t;
uniform float sw_chroma;
uniform float sw_pull;
uniform float sw_ink;
uniform float sw_edge;
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
    vec3 g = glass.a > 0.004 ? glass.rgb / glass.a : vec3(0.0);

    // the field, as the Music widgets': sine domain warps fold bands of the four cover colours
    // into slow ribbons that roll and turn
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
    field = sw_ink < 0.0 ? field * (1.0 + 0.20 * sw_ink) : mix(field, vec3(1.0), 0.20 * sw_ink);
    field += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

    // the swirl's colour at the glass's own lightness, then a pull towards the swirl itself
    vec3 hue = clamp(field + (sw_luma(g) - sw_luma(field)), 0.0, 1.0);
    vec3 c = mix(g, hue, sw_chroma);
    c = mix(c, field, sw_pull);

    // the rounded card: coverage from the rounded-rectangle distance, and the 1 px edge line
    vec2 size = vec2(sw_w, sw_h);
    vec2 q = abs(uv * size - 0.5 * size) - (0.5 * size - sw_radius);
    float inside = sw_radius - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
    float a = clamp(inside + 0.5, 0.0, 1.0);
    c = mix(c, vec3(1.0), sw_edge * (1.0 - smoothstep(0.5, 1.5, inside)));
    cogl_color_out = vec4(c * a, a) * cogl_color_in.a;
`;

const SwirlGlassEffect = GObject.registerClass(
class TahoeLockSwirlGlassEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
        this._floats = {sw_w: 1, sw_h: 1, sw_radius: RADIUS, sw_t: 0, sw_chroma: 0, sw_pull: 0, sw_ink: 0, sw_edge: EDGE};
        this._colours = swirlPalette(null);
        this.paints = 0;
    }

    set(floats, colours) {
        Object.assign(this._floats, floats);
        if (colours)
            this._colours = colours;
        this.queue_repaint();   // only the shader runs again, over the clone already rendered
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeLockSwirl) {
            pipeline.add_snippet(this._snippet);
            pipeline._tahoeLockSwirl = true;
        }
        const actor = this.get_actor();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        Object.assign(this._floats, {
            sw_w: Math.max(1, actor.width * scale), sw_h: Math.max(1, actor.height * scale),
            sw_radius: RADIUS * scale,
        });
        for (const [name, value] of Object.entries(this._floats))
            pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
        this._colours.forEach((c, i) =>
            pipeline.set_uniform_float(pipeline.get_uniform_location(`sw_c${i}`), 3, 1, c));
        super.vfunc_paint_target(node, paintContext);
        this.paints++;
    }
});

// ---- one card's glass and swirl ----

class CardGlass {
    constructor(frame, layer, card, background) {
        this._frame = frame;
        this._card = card;
        this._player = card._player ?? null;
        this.actor = new St.Widget({
            name: 'now-playing-glass',
            reactive: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._clone = new Clutter.Clone({source: background});
        this.actor.add_child(this._clone);
        this._effect = new SwirlGlassEffect();
        this.actor.add_effect_with_name('tahoe-lock-swirl', this._effect);
        layer.add_child(this.actor);

        this._t = Math.random() * 200;
        this._last = 0;
        this._from = null;
        this._to = swirlPalette(null);
        this._lab = null;
        this._fade = 1;
        this._ink = null;
        this._inkFrom = 0;
        this._uri = undefined;
        this._serial = 0;
        this._frameId = 0;

        frame.connect(card, 'notify::allocation', () => this.place());
        frame.connect(card, 'notify::mapped', () => {
            this.place();
            this.check();
        });
        frame.connect(card, 'notify::visible', () => this.place());
        if (this._player)
            frame.connect(this._player, 'changed', () => this._update());
        this._update();
        this.place();
    }

    // follow the card: its position on the stage, in the layer's coordinates
    place() {
        const card = this._card;
        if (!this._effect)
            return;
        if (!card.mapped || !card.visible) {
            this.actor.hide();
            return;
        }
        // the layer covers the dialog from its origin, untransformed: stage minus the layer's place
        const [sx, sy] = card.get_transformed_position();
        const [w, h] = card.get_transformed_size();
        const [lx, ly] = this.actor.get_parent().get_transformed_position();
        const x = sx - lx, y = sy - ly;
        if (![x, y, w, h].every(Number.isFinite))
            return;
        this.actor.set_position(Math.round(x), Math.round(y));
        this.actor.set_size(Math.round(w), Math.round(h));
        // the clone sits where the real background is, so the glass shows what is under the card
        this._clone.set_position(-Math.round(x), -Math.round(y));
        this.actor.show();
    }

    setBackground(background) {
        this._clone.source = background;
    }

    _update() {
        const player = this._player;
        if (!player)
            return;
        // only a local cover: nothing is fetched from the network while the screen is locked
        const url = player.trackCoverUrl;
        this._setCover(url?.startsWith('file://') ? url : null);
        this._playing = player.status === 'Playing';
        this.check();
    }

    _setCover(uri) {
        if (uri === this._uri)
            return;
        this._uri = uri;
        const serial = ++this._serial;
        coverPalette(uri).then(lab => this._frame.guard(() => {
            if (serial !== this._serial || !this._effect)
                return;
            this._lab = lab;
            this._from = this._current();
            this._to = swirlPalette(lab);
            this._inkFrom = this._inkValue();
            this._ink = lab ? wantsDarkInk(this._to) : null;
            if (this._ink)
                this._frame.addStyleClass(this._card, INK_DARK);
            else
                this._frame.removeStyleClass(this._card, INK_DARK);
            this._fade = this._animating() ? 0 : 1;
            this._show();
            this.check();
        }));
    }

    // a lit screen, a shown card and animations on
    _animating() {
        if (!St.Settings.get().enable_animations || !this._card.mapped)
            return false;
        const shield = Main.screenShield;
        if (shield?._shortLightbox?.active || shield?._longLightbox?.active)
            return false;
        // Mutter 51 has no readable power-save state, so: still after IDLE_STOP of no input on the
        // lock screen (a screen that has gone dark is an idle one), moving again on the next input
        return !idle.idle;
    }

    check() {
        if (!this._effect)
            return;
        const want = this._animating() && (this._playing || this._fade < 1);
        if (want && !this._frameId) {
            this._last = GLib.get_monotonic_time() / 1e6;
            this._frameId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / FPS), () =>
                this._frame.guard(() => this._tick()) ?? GLib.SOURCE_REMOVE);
        } else if (!want && this._frameId) {
            GLib.source_remove(this._frameId);
            this._frameId = 0;
            if (this._fade < 1) {
                this._fade = 1;
                this._show();
            }
        }
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1e6;
        const dt = Math.min(0.2, Math.max(0, now - this._last));
        this._last = now;
        if (this._playing)
            this._t = (this._t + dt * SPEED) % 10000;
        if (this._fade < 1)
            this._fade = Math.min(1, this._fade + dt / FADE);
        this._show();
        if (!this._playing && this._fade >= 1) {
            this._frameId = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _current() {
        if (!this._from || !this._to)
            return this._to;
        const f = this._fade * this._fade * (3 - 2 * this._fade);
        return this._to.map((c, i) => c.map((v, j) => this._from[i][j] + (v - this._from[i][j]) * f));
    }

    _inkValue() {
        const to = this._ink === null ? 0 : this._ink ? 1 : -1;
        return this._inkFrom + (to - this._inkFrom) * Math.min(1, this._fade);
    }

    _show() {
        const k = this._lab ? 1 : NEUTRAL;
        this._effect.set({sw_t: this._t, sw_chroma: CHROMA * k, sw_pull: PULL * k, sw_ink: this._inkValue()},
            this._current());
    }

    get swirling() {
        return this._frameId !== 0;
    }

    destroy() {
        if (this._frameId)
            GLib.source_remove(this._frameId);
        this._frameId = 0;
        this._serial++;
        this._effect = null;
        this.actor.destroy();
    }
}

// ---- all the cards of a dialog ----

export function buildNowPlaying(frame, dialog, background) {
    const box = dialog._notificationsBox;
    const list = box?._notificationBox;
    if (!list)
        throw new Error('the unlock notifications box has changed');

    // our layer, just above the lock picture and below GNOME's dialog contents
    const layer = new St.Widget({name: 'now-playing-layer', reactive: false, layout_manager: new Clutter.FixedLayout()});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);
    dialog.set_child_above_sibling(layer, dialog._backgroundGroup);

    const cards = new Map();
    const sync = () => {
        const media = list.get_children().filter(c => c.has_style_class_name?.('media-message'));
        for (const [card, glass] of cards) {
            if (!media.includes(card)) {
                glass.destroy();
                cards.delete(card);
            }
        }
        for (const card of media) {
            if (!cards.has(card))
                cards.set(card, new CardGlass(frame, layer, card, background()));
        }
    };
    frame.addUndo(() => {
        for (const glass of cards.values())
            glass.destroy();
        cards.clear();
    });
    frame.connect(list, 'child-added', sync);
    frame.connect(list, 'child-removed', sync);
    // the card moves with the box, the scroll and our own translation of the box
    const placeAll = () => cards.forEach(g => g.place());
    frame.connect(box, 'notify::allocation', placeAll);
    frame.connect(box, 'notify::translation-y', placeAll);
    const vadj = box._scrollView?.vadjustment;
    if (vadj)
        frame.connect(vadj, 'notify::value', placeAll);
    // the swirl stops while the screen dims or sleeps, and when animations go off
    const checkAll = () => cards.forEach(g => g.check());
    const shield = Main.screenShield;
    for (const lightbox of [shield?._shortLightbox, shield?._longLightbox]) {
        if (lightbox)
            frame.connect(lightbox, 'notify::active', checkAll);
    }
    frame.connect(global.backend.get_monitor_manager(), 'power-save-mode-changed', checkAll);
    // idle: a watch that fires after IDLE_STOP without input, then a one-shot watch for the
    // next input; both removed with the dialog
    const monitor = global.backend.get_core_idle_monitor();
    let activeId = 0;
    idle.idle = false;
    const idleId = monitor.add_idle_watch(IDLE_STOP * 1000, () => frame.guard(() => {
        idle.idle = true;
        checkAll();
        activeId ||= monitor.add_user_active_watch(() => frame.guard(() => {
            activeId = 0;
            idle.idle = false;
            checkAll();
        }));
    }));
    frame.addUndo(() => {
        monitor.remove_watch(idleId);
        if (activeId)
            monitor.remove_watch(activeId);
        idle.idle = false;
    });
    frame.connect(St.Settings.get(), 'notify::enable-animations', checkAll);
    // GNOME and Blur My Shell rebuild the backgrounds when monitors change
    frame.connect(dialog._backgroundGroup, 'child-added', () => cards.forEach(g => g.setBackground(background())));
    sync();

    return {
        get cards() {
            return [...cards.values()];
        },
    };
}
