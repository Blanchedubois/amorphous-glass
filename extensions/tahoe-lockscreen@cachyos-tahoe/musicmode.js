// Music mode (docs/GDM_PLAN.md, "Lock screen music mode"; the user's design A, 2026-10-20).
// While something plays (and GNOME would show its media card on the lock screen):
// - the lock background becomes the Music widget's album-colour swirl, cross-faded in over the
//   picture. It is an effect ON GNOME's lock background actors, so everything that copies them
//   (the glass clock, the glass widgets, the music card's glass) bends the swirl too;
// - the player sits in the centre on plain Liquid Glass (no swirl of its own: the background
//   already swirls), as the biggest Music widget that fits between the clock and the prompt:
//   the Large widget (cover across the top, 1.5x or 1.25x on big monitors), else the wide one
//   drawn 1.5x, else the wide one;
// - Now Playing's own card steps aside (nowplaying.js setSuppressed).
// When it pauses or stops, the picture comes back and Now Playing returns.
// The swirl moves only while the gate allows (not idle, not dimming, animations on); otherwise it
// holds still. Everything is added through the safety frame and undone with it.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {glassMode} from './widgets/glass.js';
import {acquirePlayer, releasePlayer} from './widgets/mpris.js';
import {MusicLarge, MusicMedium} from './widgets/music.js';
import {coverPalette, swirlPalette} from './widgets/palette.js';
import {GlassPane} from './widgets/paneglass.js';

export const MUSIC_MODE = {enabled: true};

// tokens/radius.json widget: every card on the lock screen is a widget card
const RADIUS = 24;
const FPS = 25;            // the swirl is slow: 25 frames a second is plenty
const FADE = 1.2;          // s, picture to swirl and back
const DIM = 0.14;          // the swirl a little deeper, for the white clock and text

// the player's card, biggest first; the first that fits the room is used. The Large widget grows
// on big monitors (its cover and buttons in code, the text in lockscreen.css .tahoe-lock-large-*);
// its card keeps 16 px padding and 24 px corners at every size. size: [w, h] logical px, h the
// least the card takes (the content may ask for more: measured when built).
const LARGE = scale => ({
    name: `large-${scale}`, cls: MusicLarge, type: 'music-large', options: {scale},
    styleClass: scale > 1 ? `tahoe-lock-large-${Math.round(scale * 100)}` : null,
    size: [32 + Math.round(324 * scale), 32 + Math.round(472 * scale)],
});
const CARDS = [
    LARGE(1.5),
    LARGE(1.25),
    LARGE(1),
    {name: 'wide-big', cls: MusicMedium, type: 'music-medium', size: [534, 239], options: {scale: 1.5}, styleClass: 'tahoe-lock-np-big'},
    {name: 'wide', cls: MusicMedium, type: 'music-medium', size: [356, 170]},
];
const ROOM_SHARE = 0.92;   // the card leaves a little air above and below in its room
const WIDTH_SHARE = 0.42;  // and never takes more than this share of the monitor's width

// ---- the swirl as the whole background: swirl.js' wave field over the picture ----
const DECLARATIONS = `
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
class TahoeLockBackgroundSwirl extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(FIELD);
        this.floats = {lm_t: Math.random() * 200, lm_aspect: 16 / 9, lm_amount: 0, lm_dim: DIM};
        this.colours = swirlPalette(null);
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
        this.floats.lm_aspect = Math.max(1, actor.width) / Math.max(1, actor.height);
        for (const [name, value] of Object.entries(this.floats))
            pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
        this.colours.forEach((c, i) =>
            pipeline.set_uniform_float(pipeline.get_uniform_location(`lm_c${i}`), 3, 1, c));
        super.vfunc_paint_target(node, paintContext);
    }
});

// how many music mode swirls are moving right now (tools/lockscreen music-idle gate)
const running = new Set();
export function musicFramesRunning() {
    return running.size;
}

// backdrop: () => the primary monitor's lock background actor (the glass copies it); onChange: music
// mode went on or off (the layout places things again); onWake: input after idle (others' ticks)
export function buildMusicMode(frame, dialog, nowPlaying, backdrop, onChange, onWake) {
    const gate = nowPlaying.gate;
    const player = acquirePlayer();
    frame.addUndo(() => releasePlayer());

    // ---- the background swirl, on every lock background actor ----
    let amount = 0;          // 0 the picture, 1 the swirl
    let target = 0;
    let colours = swirlPalette(null);
    const effects = new Set();
    const addSwirl = actor => {
        const effect = new BackgroundSwirl();
        // off while it shows nothing (no offscreen pass over the picture when nothing plays)
        effect.enabled = amount > 0;
        actor.add_effect_with_name('tahoe-lock-music-swirl', effect);
        effects.add(effect);
        frame.addUndo(() => {
            effects.delete(effect);
            if (effect.get_actor())
                actor.remove_effect(effect);
        });
    };
    for (const actor of dialog._backgroundGroup)
        addSwirl(actor);
    frame.connect(dialog._backgroundGroup, 'child-added', (_g, actor) => addSwirl(actor));

    const paint = () => {
        for (const e of effects) {
            e.enabled = amount > 0;
            e.floats.lm_amount = amount;
            e.colours = colours;
            e.queue_repaint();
        }
    };

    // ---- the player's card, on our own layer over the dialog ----
    const layer = new St.Widget({name: 'music-mode-layer', reactive: false, layout_manager: new Clutter.FixedLayout()});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);
    let shown = null;        // {spec, actor, widget}
    const dropCard = () => {
        if (!shown)
            return;
        stopTick();
        shown.widget.destroy();
        shown.actor.destroy();
        shown = null;
    };
    frame.addUndo(dropCard);
    const makeCard = spec => {
        const actor = new St.Widget({
            style_class: `tahoe-widget tahoe-widget-${spec.type} tahoe-lock-pane`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        if (spec.styleClass)
            actor.add_style_class_name(spec.styleClass);
        actor.width = spec.size[0];
        actor.add_child(new GlassPane(backdrop, RADIUS));
        const content = new St.Widget({
            style_class: 'tahoe-widget-content',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true,
        });
        actor.add_child(content);
        // its own swirl never runs (gate false): the background swirls; the widget still takes
        // its text colour from the cover
        const widget = new spec.cls({swirl: {lockScreen: true, gate: () => false}, ...spec.options});
        widget.setMode(glassMode());
        content.add_child(widget.actor);
        widget.attachCard({actor, monitorIndex: Main.layoutManager.primaryIndex, addBackdropEffect() {}});
        widget.requestTick = () => frame.guard(syncTick);
        layer.add_child(actor);
        // the height: at least the spec's, more if the content asks for it
        const [, natural] = actor.get_preferred_height(spec.size[0]);
        const height = Math.max(spec.size[1], Math.ceil(natural));
        actor.height = height;
        return {spec, actor, widget, size: [spec.size[0], height]};
    };

    // ---- the 1 s tick (the progress), only while playing and the gate allows ----
    let tickId = 0;
    const stopTick = () => {
        if (tickId)
            GLib.source_remove(tickId);
        tickId = 0;
    };
    const syncTick = () => {
        if (!shown)
            return stopTick();
        shown.widget.tick(GLib.DateTime.new_now_local());
        const want = shown.actor.visible && shown.widget.wantsSeconds && gate();
        if (want && !tickId) {
            tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () =>
                frame.guard(() => {
                    if (!shown || !shown.widget.wantsSeconds || !gate())
                        return (tickId = 0, GLib.SOURCE_REMOVE);
                    shown.widget.tick(GLib.DateTime.new_now_local());
                    return GLib.SOURCE_CONTINUE;
                }) ?? GLib.SOURCE_REMOVE);
        } else if (!want) {
            stopTick();
        }
    };

    // ---- the swirl's frames: while fading, or playing and the gate allows ----
    let frameId = 0;
    let last = 0;
    const token = {};   // this instance in `running`
    const stopFrames = () => {
        if (frameId)
            GLib.source_remove(frameId);
        frameId = 0;
        running.delete(token);
    };
    const animating = () => St.Settings.get().enable_animations;
    const syncFrames = () => {
        const fading = amount !== target;
        const moving = active && gate() && animating();
        if ((fading || moving) && !frameId) {
            last = GLib.get_monotonic_time() / 1e6;
            running.add(token);
            frameId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / FPS), () =>
                frame.guard(() => {
                    const now = GLib.get_monotonic_time() / 1e6;
                    const dt = Math.min(0.2, Math.max(0, now - last));
                    last = now;
                    if (amount !== target) {
                        const step = animating() ? dt / FADE : 1;
                        amount = target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
                    }
                    if (active && gate() && animating())
                        for (const e of effects)
                            e.floats.lm_t = (e.floats.lm_t + dt) % 10000;
                    paint();
                    if (amount !== target || (active && gate() && animating()))
                        return GLib.SOURCE_CONTINUE;
                    frameId = 0;
                    running.delete(token);
                    return GLib.SOURCE_REMOVE;
                }) ?? (running.delete(token), frameId = 0, GLib.SOURCE_REMOVE));
        } else if (!fading && !moving) {
            stopFrames();
        }
    };
    frame.addUndo(stopFrames);

    // ---- on or off: playing, and GNOME would show its media card ----
    let active = false;
    let coverUri;
    let serial = 0;
    const update = () => {
        const state = player.state;
        const want = MUSIC_MODE.enabled && nowPlaying.wanted && Boolean(state?.playing);
        // the cover's colours, read once per cover (a web cover: what is cached locally, or none)
        const art = state ? player.art(state.artUrl) : null;
        if (art !== coverUri) {
            coverUri = art;
            const mine = ++serial;
            coverPalette(art).then(lab => frame.guard(() => {
                if (mine !== serial)
                    return;
                colours = swirlPalette(lab);
                paint();
            })).catch(() => {});
        }
        if (want !== active) {
            active = want;
            target = active ? 1 : 0;
            nowPlaying.setSuppressed(active);
            if (!active)
                dropCard();
            onChange?.();
        }
        syncFrames();
        syncTick();
    };
    const listener = () => frame.guard(update);
    player.listen(listener);
    frame.addUndo(() => player.unlisten(listener));

    // the gate changes (idle, dimming, animations): the frames and the tick follow
    const recheck = () => frame.guard(() => {
        syncFrames();
        syncTick();
        onWake?.();
    });
    const shield = Main.screenShield;
    for (const lightbox of [shield?._shortLightbox, shield?._longLightbox]) {
        if (lightbox)
            frame.connect(lightbox, 'notify::active', recheck);
    }
    frame.connect(St.Settings.get(), 'notify::enable-animations', recheck);
    const idleMonitor = global.backend.get_core_idle_monitor();
    let activeWatch = 0;
    // the frames stop themselves when the gate closes (nowplaying.js: 30 s idle); after any idle
    // second, the next input starts them again, a moment later so Now Playing's own active
    // watch has cleared its idle flag first
    let wakeId = 0;
    const idleWatch = idleMonitor.add_idle_watch(1000, () => frame.guard(() => {
        activeWatch ||= idleMonitor.add_user_active_watch(() => {
            activeWatch = 0;
            if (!wakeId)
                wakeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    wakeId = 0;
                    recheck();
                    return GLib.SOURCE_REMOVE;
                });
        });
    }));
    frame.addUndo(() => {
        if (wakeId)
            GLib.source_remove(wakeId);
        wakeId = 0;
    });
    frame.addUndo(() => {
        idleMonitor.remove_watch(idleWatch);
        if (activeWatch)
            idleMonitor.remove_watch(activeWatch);
    });

    frame.addCheck('music mode', () => {
        if (!active || !shown)
            return null;
        if (!shown.actor.mapped)
            return 'the music card is not shown';
        const [w, h] = shown.actor.get_transformed_size();
        const [ew, eh] = shown.size;
        return w >= ew - 1 && h >= eh - 1 ? null : 'the music card is cut off';
    });

    update();

    return {
        get active() {
            return active;
        },
        // the card in the room between top and bottom (px below the monitor's top), centred;
        // returns the height it takes (0 when music mode is off)
        fit(monitorBox, top, bottom) {
            if (!active)
                return 0;
            const room = bottom - top;
            // GNOME's first layout pass comes before the dialog has its size: wait for the real
            // room (the stack's next allocation places everything again)
            if (!(room > 0))
                return shown ? shown.size[1] : 0;
            const fits = size => size[1] <= room * ROOM_SHARE && size[0] <= monitorBox.width * WIDTH_SHARE;
            // the biggest card whose least size fits (none: the smallest); built, then measured:
            // if its content asked for more than the room, the next smaller one
            let start = CARDS.findIndex(c => fits(c.size));
            if (start < 0)
                start = CARDS.length - 1;
            // rebuilt only when the room calls for a different start (a monitor change, the
            // notifications column), never on every layout pass
            if (!shown || shown.tried !== start) {
                dropCard();
                for (let i = start; i < CARDS.length; i++) {
                    shown = makeCard(CARDS[i]);
                    shown.tried = start;
                    if (GLib.getenv('TAHOE_LOCK_DEBUG'))
                        console.warn(`tahoe-lockscreen: music card ${CARDS[i].name} room ${room} monitor ${monitorBox.width}x${monitorBox.height} size ${shown.size}`);
                    if (fits(shown.size) || i === CARDS.length - 1)
                        break;
                    dropCard();
                }
                syncTick();
            }
            const [w, h] = shown.size;
            const y = Math.round(top + Math.max(0, (room - h) / 2));
            shown.actor.set_position(Math.round(monitorBox.x + (monitorBox.width - w) / 2), Math.round(monitorBox.y + y));
            return h;
        },
    };
}
