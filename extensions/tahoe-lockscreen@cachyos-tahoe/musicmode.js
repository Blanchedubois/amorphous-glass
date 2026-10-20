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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {glassMode} from './widgets/glass.js';
import {acquirePlayer, releasePlayer} from './widgets/mpris.js';
import {MusicLarge, MusicMedium} from './widgets/music.js';
import {coverPalette, swirlPalette} from './widgets/palette.js';
import {GlassPane} from './widgets/paneglass.js';
import {BackgroundSwirl} from './bgswirl.js';

export const MUSIC_MODE = {enabled: true};

// tokens/radius.json widget: every card on the lock screen is a widget card
const RADIUS = 24;
const FPS = 25;            // the swirl is slow: 25 frames a second is plenty
const FADE = 1.2;          // s, picture to swirl and back

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

// ---- the song for the login screen (Switch User) ----
//
// GNOME locks the session before it switches to the login screen, so while the screen is locked
// this writes what plays into a folder the login screen may read (the user's choice, 2026-10-20:
// one user, the song may be seen): state.json (title, artist, playing, this shell's pid, the
// cover's file name) and the cover itself (cover-<hash>). The folder is made at install (scripts/gdm-theme.sh, a
// tmpfiles.d entry: /run/tahoe-nowplaying, the user's, readable by all); without it nothing is
// written. On unlock (the frame's undo) the files go, so the login screen never shows a song
// from a session that is no longer locked, and it checks the pid is still a gnome-shell.
const SHARE_DIR = GLib.getenv('TAHOE_NOWPLAYING_DIR') || '/run/tahoe-nowplaying';

function shareFile(name) {
    return Gio.File.new_for_path(GLib.build_filenamev([SHARE_DIR, name]));
}

// state.json and every cover but `keep`
function shareClear(keep = null) {
    try {
        const dir = Gio.File.new_for_path(SHARE_DIR);
        const files = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let info; (info = files.next_file(null));) {
            const name = info.get_name();
            if (name.startsWith('cover-') && name !== keep)
                try { dir.get_child(name).delete(null); } catch {}
        }
        files.close(null);
    } catch {}
    if (keep === null)
        try { shareFile('state.json').delete(null); } catch {}
}

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
    // At lock, with music already playing, the swirl is there from the start: no fade in from the
    // picture (that read as a glitch on Super+L, user 2026-10-20). It shows as soon as the cover's
    // colours are read (a moment: a cached file), or after SETTLE_WAIT without them.
    const builtAt = GLib.get_monotonic_time() / 1e6;
    const SETTLE = 2.5;        // s after the lock screen is built: still "at lock"
    const SETTLE_WAIT = 0.4;   // s: the longest the swirl waits for the colours at lock
    let jumpTimer = 0;       // the SETTLE_WAIT timeout
    let jumpPending = false; // waiting for the colours at lock
    let colorsKnown = false;
    const jump = () => {
        jumpPending = false;
        if (jumpTimer)
            GLib.source_remove(jumpTimer);
        jumpTimer = 0;
        if (!active)
            return;
        amount = target = 1;
        paint();
        syncFrames();
    };
    frame.addUndo(() => {
        if (jumpTimer)
            GLib.source_remove(jumpTimer);
        jumpTimer = 0;
    });

    const update = () => {
        const state = player.state;
        const want = MUSIC_MODE.enabled && nowPlaying.wanted && Boolean(state?.playing);
        // the cover's colours, read once per cover (a web cover: what is cached locally, or none)
        const art = state ? player.art(state.artUrl) : null;
        if (art !== coverUri) {
            coverUri = art;
            colorsKnown = false;
            const mine = ++serial;
            coverPalette(art).then(lab => frame.guard(() => {
                if (mine !== serial)
                    return;
                colours = swirlPalette(lab);
                colorsKnown = true;
                paint();
                if (jumpPending)
                    jump();
            })).catch(() => {});
        }
        if (want !== active) {
            active = want;
            target = active ? 1 : 0;
            // at lock: straight to the swirl (when the colours are known, or shortly)
            if (active && GLib.get_monotonic_time() / 1e6 - builtAt < SETTLE) {
                if (colorsKnown) {
                    jump();
                } else if (!jumpPending) {
                    jumpPending = true;
                    jumpTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(SETTLE_WAIT * 1000), () => {
                        jumpTimer = 0;
                        frame.guard(jump);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            nowPlaying.setSuppressed(active);
            if (!active)
                dropCard();
            onChange?.();
        }
        syncFrames();
        syncTick();
    };
    // the song for the login screen, written when it changes (only what GNOME would show here)
    const pid = Gio.Credentials.new().get_unix_pid();
    let shared = '';
    let sharedCover = null;
    const share = () => {
        if (!GLib.file_test(SHARE_DIR, GLib.FileTest.IS_DIR))
            return;   // not set up (scripts/gdm-theme.sh install)
        const state = nowPlaying.wanted ? player.state : null;
        const art = state ? player.art(state.artUrl) : null;
        // the cover as cover-<sha1 of its uri>: a new name for each cover, so the login screen
        // never draws an old one from its texture cache; copied as bytes, so the copy is
        // readable by the login screen (the cache is not)
        const coverName = art ? `cover-${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, art, -1)}` : null;
        let cover = null;
        try {
            if (art !== sharedCover) {
                if (art) {
                    const [, bytes] = Gio.File.new_for_uri(art).load_contents(null);
                    GLib.file_set_contents(shareFile(coverName).get_path(), bytes);
                }
                sharedCover = art;
                shareClear(coverName ?? '');
            }
            cover = coverName;
        } catch {
            sharedCover = null;
        }
        const info = state ? {
            pid, title: state.title ?? '', artist: state.artist ?? '',
            playing: Boolean(state.playing), cover,
        } : null;
        const json = info ? JSON.stringify(info) : '';
        if (json === shared)
            return;
        shared = json;
        try {
            if (info)
                GLib.file_set_contents(shareFile('state.json').get_path(), json);   // atomic (a rename)
            else
                shareClear();
            if (!info)
                sharedCover = null;
        } catch (e) {
            console.warn(`tahoe-lockscreen: cannot share the song with the login screen: ${e}`);
        }
    };
    frame.addUndo(() => shareClear());

    const listener = () => frame.guard(() => {
        update();
        share();
    });
    player.listen(listener);
    nowPlaying.onWantedChanged(listener);
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
    share();

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
