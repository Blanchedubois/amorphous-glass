// The song on the login screen, for Switch User (the user's choice, 2026-10-20: one user, the song
// may be seen): while the user's session is locked behind this login screen and music plays, the
// lock screen's album-colour swirl over the picture and, between the clock and the avatar, the
// cover with the title and artist on a Liquid Glass card. Display only: no controls (they would
// control the user's session from the login screen).
//
// The login screen runs as a system account and cannot ask the session's player. The session's
// lock screen (tahoe-lockscreen musicmode.js) writes the song into /run/tahoe-nowplaying while it is
// locked (made at install by scripts/gdm-theme.sh, the user's, readable by all): state.json and the
// cover (cover-<sha1>). Shown only while state.json says playing and its pid is still a gnome-shell
// of the same user as the file; the files go when the session unlocks.
//
// The picture behind the login screen becomes one actor (buildBackdrop) at the bottom of the
// login screen's group, as the theme draws it; every glass pane copies that actor, so with the
// swirl on it the glass bends the swirl. Anything failing here hides the song and leaves the rest.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './glass.js';
import {BackgroundSwirl} from './widgets/bgswirl.js';
import {coverPalette, swirlPalette} from './widgets/palette.js';

const DIR = GLib.getenv('TAHOE_NOWPLAYING_DIR') || '/run/tahoe-nowplaying';
const STATE_MAX = 4096;          // bytes: state.json is far smaller
const COVER_MAX = 8 << 20;       // bytes
const CHECK = 5;                 // s: the session's shell still there
const FPS = 25;                  // as the lock screen's swirl
const FADE = 1.2;                // s, picture to swirl and back
const IDLE = 30;                 // s without input: the swirl holds still (as on the lock screen)
const RADIUS = 24;               // tokens/radius.json widget
const PAD = 16;                  // the card's padding, as the widgets'
const COVER_RADIUS = 8;          // tokens/radius.json cover
const COVER = [0.085, 64, 144];  // the cover's side: share of the monitor's height, least, most
const COVER_SMALLEST = 44;       // shrunk to fit a small room, never below this (then no card)
const TEXT = [2.2, 200];         // the text column's width: in covers, least px
const TYPE = [[0.15, 14], [0.12, 12]];   // title and artist size: share of the cover, least px
const CLOCK_BOTTOM = 0.264;      // the clock digits' bottom, share of the height (layout.js)
const GAP = 0.025;               // clear of the clock and of the rows, share of the height

const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
const decoder = new TextDecoder();

// a regular file (no link) of at most `max` bytes, and its owner; null otherwise
function regular(file, max) {
    const info = file.query_info('standard::type,standard::size,unix::uid', NOFOLLOW, null);
    if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > max)
        return null;
    return info.get_attribute_uint32('unix::uid');
}

// the song, if the session that wrote it is still there and it plays; null otherwise
function readSong() {
    const dir = Gio.File.new_for_path(DIR);
    const file = dir.get_child('state.json');
    let uid;
    try {
        uid = regular(file, STATE_MAX);
    } catch {
        return null;   // no song
    }
    if (uid === null)
        return null;
    const state = JSON.parse(decoder.decode(file.load_contents(null)[1]));
    if (state?.playing !== true || !Number.isInteger(state.pid) || state.pid <= 1)
        return null;
    // the writer's gnome-shell, of the same user as the file
    try {
        const proc = Gio.File.new_for_path(`/proc/${state.pid}`);
        if (proc.query_info('unix::uid', 0, null).get_attribute_uint32('unix::uid') !== uid)
            return null;
        if (decoder.decode(proc.get_child('comm').load_contents(null)[1]).trim() !== 'gnome-shell')
            return null;
    } catch {
        return null;   // gone
    }
    let cover = null;
    if (typeof state.cover === 'string' && /^cover-[0-9a-f]{40}$/.test(state.cover)) {
        const file = dir.get_child(state.cover);
        try {
            if (regular(file, COVER_MAX) === uid)
                cover = file.get_uri();
        } catch {}
    }
    const text = v => (typeof v === 'string' ? v : '').slice(0, 300);
    return {title: text(state.title), artist: text(state.artist), cover};
}

// The picture behind everything, as the theme draws it, as one actor (the glass panes copy it).
// Returns a function giving it, the panes' backdrop.
export function buildBackdrop(ext, picture) {
    const group = Main.screenShield._lockDialogGroup;
    const actor = new St.Widget({
        name: 'tahoe-gdm-backdrop',
        reactive: false,
        style: `background-image: url("${picture.get_uri()}"); background-size: cover;`,
    });
    actor.add_constraint(new Clutter.BindConstraint({source: group, coordinate: Clutter.BindCoordinate.SIZE}));
    group.insert_child_at_index(actor, 0);
    ext._undo.push(() => actor.destroy());
    return () => actor;
}

export function buildNowPlaying(ext, backdrop) {
    const group = Main.screenShield._lockDialogGroup;
    const cleanups = [];
    let stopped = false;
    // a fault here hides the song only; the rest of the login screen stays
    const stop = e => {
        if (stopped)
            return;
        stopped = true;
        console.warn(`tahoe-gdm: the song on the login screen is off: ${e}`);
        cleanups.splice(0).reverse().forEach(fn => {
            try {
                fn();
            } catch {}
        });
    };
    const guard = fn => (...args) => {
        if (stopped)
            return undefined;
        try {
            return fn(...args);
        } catch (e) {
            stop(e);
            return undefined;
        }
    };
    ext._undo.push(() => {
        stopped = true;
        cleanups.splice(0).reverse().forEach(fn => fn());
    });

    // ---- the swirl, on the backdrop ----
    const effect = new BackgroundSwirl();
    effect.enabled = false;   // no offscreen pass over the picture while nothing plays
    backdrop().add_effect_with_name('tahoe-gdm-swirl', effect);
    cleanups.push(() => effect.get_actor()?.remove_effect(effect));

    let active = false;
    let amount = 0, target = 0;
    let idle = false;
    let frameId = 0, last = 0;
    const animating = () => St.Settings.get().enable_animations;
    const moving = () => active && !idle && animating();
    const paint = () => {
        effect.enabled = amount > 0;
        effect.floats.lm_amount = amount;
        effect.queue_repaint();
    };
    const syncFrames = () => {
        if (frameId || (amount === target && !moving()))
            return;
        last = GLib.get_monotonic_time() / 1e6;
        frameId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / FPS), () => guard(() => {
            const now = GLib.get_monotonic_time() / 1e6;
            const dt = Math.min(0.2, Math.max(0, now - last));
            last = now;
            if (amount !== target) {
                const step = animating() ? dt / FADE : 1;
                amount = target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
            }
            if (moving())
                effect.floats.lm_t = (effect.floats.lm_t + dt) % 10000;
            paint();
            if (amount !== target || moving())
                return GLib.SOURCE_CONTINUE;
            frameId = 0;
            return GLib.SOURCE_REMOVE;
        })() ?? (frameId = 0, GLib.SOURCE_REMOVE));
    };
    cleanups.push(() => {
        if (frameId)
            GLib.source_remove(frameId);
        frameId = 0;
    });

    // still after IDLE s without input, moving again at the next input
    const idleMonitor = global.backend.get_core_idle_monitor();
    let activeWatch = 0;
    const idleWatch = idleMonitor.add_idle_watch(IDLE * 1000, guard(() => {
        idle = true;
        activeWatch ||= idleMonitor.add_user_active_watch(guard(() => {
            activeWatch = 0;
            idle = false;
            syncFrames();
        }));
    }));
    cleanups.push(() => {
        idleMonitor.remove_watch(idleWatch);
        if (activeWatch)
            idleMonitor.remove_watch(activeWatch);
        activeWatch = 0;
    });
    const animId = St.Settings.get().connect('notify::enable-animations', guard(syncFrames));
    cleanups.push(() => St.Settings.get().disconnect(animId));

    // ---- the card ----
    const card = new St.Widget({
        name: 'tahoe-gdm-song',
        layout_manager: new Clutter.BinLayout(),
        reactive: false,
        opacity: 0,
        visible: false,
    });
    const pane = new GlassPane(backdrop, RADIUS);
    pane.connect('mask-failed', () => stop(`glass: ${pane.failed}`));
    card.add_child(pane);
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    card.add_child(row);
    const cover = new St.Widget({y_align: Clutter.ActorAlign.CENTER});
    const column = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    const title = new St.Label({style_class: 'tahoe-gdm-song-title'});
    const artist = new St.Label({style_class: 'tahoe-gdm-song-artist'});
    for (const label of [title, artist]) {
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        column.add_child(label);
    }
    row.add_child(cover);
    row.add_child(column);
    group.add_child(card);
    cleanups.push(() => card.destroy());

    let coverUri = null;
    let serial = 0;
    // the top of what GNOME shows under the card: the account rows, or the avatar over the
    // password field (layout.js moves them; a list of several accounts grows upwards)
    const dialog = Main.screenShield._dialog;
    const below = () => {
        const tops = [];
        if (dialog?._userSelectionBox?.visible) {
            for (const item of dialog._userList?._items?.values() ?? []) {
                if (item.mapped)
                    tops.push(item.get_transformed_position()[1]);
            }
        }
        const well = dialog?._authPrompt?._userWell;
        if (dialog?._authPrompt?.visible && well?.mapped)
            tops.push(well.get_transformed_position()[1]);
        return tops.length ? Math.min(...tops) : null;
    };
    const place = () => {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const H = m.height / scale;
        // the room between the clock and the rows, logical px from the monitor's top
        const top = (CLOCK_BOTTOM + GAP) * H;
        const under = below();
        const bottom = (under === null ? 0.75 * H : (under - m.y) / scale) - GAP * H;
        let side = Math.round(Math.min(COVER[2], Math.max(COVER[1], COVER[0] * H)));
        side = Math.min(side, Math.floor(bottom - top - 2 * PAD));
        fits = side >= COVER_SMALLEST;
        if (!fits) {
            syncCard();
            return;
        }
        const textWidth = Math.max(TEXT[1], Math.round(side * TEXT[0]));
        const w = PAD + side + PAD + textWidth + PAD;
        const h = PAD + side + PAD;
        const coverCss = coverUri
            ? `background-image: url("${coverUri}"); background-size: cover;`
            : 'background-color: rgba(255,255,255,0.18);';
        cover.style = `width: ${side}px; height: ${side}px; border-radius: ${COVER_RADIUS}px; ${coverCss}`;
        row.style = `padding: ${PAD}px; spacing: ${PAD}px;`;
        column.style = `width: ${textWidth}px; spacing: ${Math.round(side * 0.04)}px;`;
        [title, artist].forEach((label, i) => {
            label.style = `font-size: ${Math.max(TYPE[i][1], Math.round(side * TYPE[i][0]))}px;`;
        });
        card.set_size(w * scale, h * scale);
        const y = (top + bottom - h) / 2;
        card.set_position(m.x + Math.round((m.width - w * scale) / 2), m.y + Math.round(y * scale));
        syncCard();
    };
    // shown while a song plays and the card fits; faded in and out
    let fits = true;
    let cardShown = false;
    const syncCard = () => {
        const want = active && fits;
        if (want === cardShown)
            return;
        cardShown = want;
        card.remove_all_transitions();
        if (want)
            card.show();
        card.ease({
            opacity: want ? 255 : 0,
            duration: animating() ? 400 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (!cardShown)
                    card.hide();
            },
        });
    };
    // placed again when GNOME's prompt or rows move (not from inside the layout pass)
    const laters = global.compositor.get_laters();
    let laterId = 0;
    const replace = () => {
        if (laterId || !active)
            return;
        laterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            laterId = 0;
            guard(place)();
            return GLib.SOURCE_REMOVE;
        });
    };
    cleanups.push(() => {
        if (laterId)
            laters.remove(laterId);
        laterId = 0;
    });
    for (const actor of [dialog?._userSelectionBox, dialog?._userList, dialog?._authPrompt, dialog?._authPrompt?._userWell]) {
        if (!actor)
            continue;
        const ids = ['notify::allocation', 'notify::visible'].map(sig => actor.connect(sig, replace));
        cleanups.push(() => ids.forEach(id => actor.disconnect(id)));
    }
    const monitorsId = Main.layoutManager.connect('monitors-changed', guard(place));
    cleanups.push(() => Main.layoutManager.disconnect(monitorsId));

    const show = song => {
        const want = Boolean(song);
        if (song) {
            title.text = song.title || ' ';
            artist.text = song.artist || ' ';
            if (song.cover !== coverUri) {
                coverUri = song.cover;
                const mine = ++serial;
                effect.colours = swirlPalette(null);
                coverPalette(coverUri).then(guard(lab => {
                    if (mine !== serial)
                        return;
                    effect.colours = swirlPalette(lab);
                    paint();
                })).catch(() => {});
            }
            place();
        }
        if (want !== active) {
            active = want;
            target = active ? 1 : 0;
            syncCard();
        }
        syncFrames();
    };
    const refresh = guard(() => show(readSong()));

    // state.json changes (written by the session's lock screen), and the session's shell may go
    if (!GLib.file_test(DIR, GLib.FileTest.IS_DIR)) {
        stop(`no ${DIR} (scripts/gdm-theme.sh install makes it)`);
        return;
    }
    const monitor = Gio.File.new_for_path(DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
    monitor.set_rate_limit(200);
    const changedId = monitor.connect('changed', refresh);
    cleanups.push(() => {
        monitor.disconnect(changedId);
        monitor.cancel();
    });
    const checkId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CHECK, () => {
        refresh();
        return stopped ? GLib.SOURCE_REMOVE : GLib.SOURCE_CONTINUE;
    });
    cleanups.push(() => GLib.source_remove(checkId));

    refresh();
}
