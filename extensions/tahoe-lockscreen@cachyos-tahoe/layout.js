// The Tahoe layout (docs/LOCKSCREEN_PLAN.md, Phase 3): the date above the time at the top centre,
// shown on both pages, and the password prompt at the bottom. Everything goes through the frame
// (frame.js); GNOME's layout manager, prompt and authentication are untouched.
//
// Sizes and positions are fractions of the primary monitor's height, measured on Apple's macOS
// Tahoe press image (docs/lockscreen/shots/reference-tahoe-press.png).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import { GlassClock, MATERIAL, buildMask, measure } from './glassclock.js';
import { buildNowPlaying } from './nowplaying.js';
import { buildMenuGlass } from './menuglass.js';

const DATE_TOP = 0.108;       // top of the date's letters
// 1.5x Apple's size, as the user asked: digits 15 % of the height (Space Grotesk's digits are
// 0.730 em), the date and the gap in the same proportion
const DATE_SIZE = 0.0375;     // date type size (54 px at 1440)
const TIME_SIZE = 0.2055;     // time type size (296 px at 1440: digits 216 px, 15 %)
const TIME_GAP = 0.017;       // from the bottom of the date's letters to the top of the digits

// where the letters sit inside an St.Label line, as fractions of the type size, measured with
// Pango on Space Grotesk SemiBold: the cap/digit top below the line top, and the cap height
// (these place the plain fallback labels; the glass places its letters from Pango's ink itself)
const INK_TOP = {date: 0.278, time: 0.270};
const CAP_HEIGHT = 0.741;
const DIGITS_EM = 0.730;      // Space Grotesk's digit height
// the bottom of the clock's digits, as a fraction of the height
const CLOCK_BOTTOM = DATE_TOP + DATE_SIZE * CAP_HEIGHT + TIME_GAP + TIME_SIZE * DIGITS_EM;
const AVATAR_CENTRE = 0.825;  // centre of the avatar
const AVATAR_SIZE = 64;       // logical px, matches lockscreen.css
const BOTTOM_MARGIN = 0.04;   // the prompt never comes closer to the bottom edge than this
const COLUMN_GAP = 0.03;      // between the clock, the Now Playing column and the prompt

// GNOME's own clock labels (UnlockDialogClock), hidden while ours shows; GNOME animates the
// clock box itself, so the frame hides the labels inside it instead.
const GNOME_CLOCK_LABELS = ['_time', '_date', '_hint'];

const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

function timeText(now) {
    // 12 h without AM/PM, as on the Mac; 24 h as GNOME is set
    const h24 = interfaceSettings.get_string('clock-format') === '24h';
    return now.format(h24 ? '%H:%M' : '%l:%M').trim();
}

function dateText(now) {
    return now.format('%a %b %-d');   // "Tue Oct 20"
}

// y of an actor's allocation inside an ancestor, from the allocations alone (no translations or
// scales), so it is where GNOME's layout put it
function layoutY(actor, ancestor) {
    let y = 0;
    for (let a = actor; a && a !== ancestor; a = a.get_parent())
        y += a.get_allocation_box().y1;
    return y;
}

export function buildLayout(frame, dialog) {
    const clock = dialog._clock;
    const missing = GNOME_CLOCK_LABELS.filter(m => !(clock[m] instanceof St.Label));
    if (missing.length)
        throw new Error(`the unlock clock has changed (missing ${missing.join(', ')})`);

    sharpenBackground(frame, dialog);
    buildClock(frame, dialog);
    for (const name of GNOME_CLOCK_LABELS)
        frame.set(clock[name], 'visible', false);
    let relayout = () => {};
    const nowPlaying = buildNowPlaying(frame, dialog, () => relayout());
    relayout = placePrompt(frame, dialog, nowPlaying);
    buildMenuGlass(frame, dialog);
}

// ---- the wallpaper: sharp, as the user asked ----
//
// GNOME blurs and dims the lock picture (Shell.BlurEffect, radius 90, brightness 0.65); Blur My
// Shell's lockscreen component, when on, replaces that with its own pipeline of effects. Either
// way the effects sit on the per-monitor background actors in dialog._backgroundGroup. While the
// screen is locked the frame switches them off (enabled = false), and on unlock or any failure
// it switches them back on. The user's Blur My Shell settings are not touched.

function sharpenBackground(frame, dialog) {
    const group = dialog._backgroundGroup;
    const sharpen = actor => {
        for (const effect of actor.get_effects())
            frame.set(effect, 'enabled', false);
    };
    for (const actor of group)
        sharpen(actor);
    // GNOME and Blur My Shell rebuild the backgrounds when monitors change
    frame.connect(group, 'child-added', (_group, actor) => sharpen(actor));
}

// the background actor of the primary monitor (Blur My Shell inserts them in reverse order)
function primaryBackground(dialog) {
    const monitor = Main.layoutManager.primaryMonitor;
    const backgrounds = [...dialog._backgroundGroup];
    return backgrounds.find(b => b.x === monitor.x && b.y === monitor.y) ?? backgrounds[0] ?? null;
}

// ---- the clock: our own actor over the primary monitor, above GNOME's dialog contents ----

function buildClock(frame, dialog) {
    const area = new St.Widget({
        name: 'clock-area',
        reactive: false,
        layout_manager: new Clutter.BinLayout(),
    });
    area.add_constraint(new Layout.MonitorConstraint({primary: true}));

    const box = new St.BoxLayout({
        style_class: 'tahoe-lock-clock',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });
    const date = new St.Label({style_class: 'tahoe-lock-clock-date', x_align: Clutter.ActorAlign.CENTER, x_expand: true});
    const time = new St.Label({style_class: 'tahoe-lock-clock-time', x_align: Clutter.ActorAlign.CENTER, x_expand: true});
    box.add_child(date);
    box.add_child(time);
    area.add_child(box);
    frame.addActor(dialog, area);

    const glass = buildGlass(frame, dialog, box);
    const update = () => {
        const now = GLib.DateTime.new_now_local();
        date.text = dateText(now);
        time.text = timeText(now);
        glass.rebuild(date.text, time.text);
    };
    const wallClock = new GnomeDesktop.WallClock({time_only: true});
    wallClock.connect('notify::clock', () => frame.guard(update));
    frame.addUndo(() => wallClock.run_dispose());
    frame.connect(interfaceSettings, 'changed::clock-format', update);
    update();

    // sizes and place follow the monitor's height
    const size = () => {
        const height = area.height;
        if (!(height > 0))
            return;
        const px = f => Math.round(f * height);
        const dateSize = px(DATE_SIZE), timeSize = px(TIME_SIZE);
        date.style = `font-size: ${dateSize}px;`;
        time.style = `font-size: ${timeSize}px;`;
        // place by the letters, not the line boxes (a 190 px line has a lot of air above the digits)
        const dateLineTop = px(DATE_TOP) - Math.round(dateSize * INK_TOP.date);
        box.style = `margin-top: ${Math.max(0, dateLineTop)}px;`;
        const digitsTop = px(DATE_TOP) + Math.round(dateSize * CAP_HEIGHT) + px(TIME_GAP);
        const [, dateLineHeight] = date.get_preferred_height(-1);
        time.translation_y = digitsTop - Math.round(timeSize * INK_TOP.time) - (dateLineTop + dateLineHeight);
    };
    frame.connect(area, 'notify::size', () => {
        size();
        glass.rebuild(date.text, time.text);
    });
    size();

    frame.addCheck('clock', () => {
        if (!area.mapped || !time.mapped || !date.mapped)
            return 'the clock is not shown';
        // laid out at least as wide and tall as its text needs, and inside the monitor
        for (const label of [date, time]) {
            // the text's own width: a label given a fixed width reports that as its natural width
            const [, textWidth] = label.clutter_text.get_preferred_width(-1);
            const box = label.get_allocation_box();
            if (!label.text || box.get_width() < textWidth - 1 || box.get_height() < 1)
                return 'the clock is cut off';
        }
        const [x, y] = time.get_transformed_position();
        const [w, h] = time.get_transformed_size();
        if (x < area.x || y < area.y || x + w > area.x + area.width || y + h > area.y + area.height)
            return 'the clock is off screen';
        return null;
    });
}

// ---- the glass over the plain clock (Phase 4) ----
//
// The plain labels stay underneath as the fallback: they are hidden only once the glass has
// painted, and come back if the glass cannot be built or never paints. A glass failure therefore
// costs the glass, not the layout, and never sends the lock screen back to GNOME's.

const GLASS_PAD = 64;   // logical px around the letters, room for the bevel and the bend

function buildGlass(frame, dialog, labels) {
    const area = new St.Widget({
        name: 'glass-area',
        reactive: false,
        layout_manager: new Clutter.FixedLayout(),
    });
    area.add_constraint(new Layout.MonitorConstraint({primary: true}));
    frame.addActor(dialog, area);

    let glass = null, failed = false, verifyId = 0;
    frame.addUndo(() => {
        if (verifyId)
            GLib.source_remove(verifyId);
    });

    const giveUp = reason => {
        if (failed)
            return;
        failed = true;
        console.warn(`tahoe-lockscreen: glass clock: ${reason}; showing the plain clock`);
        glass?.actor.destroy();
        glass = null;
        labels.opacity = 255;
    };

    const backgroundOf = () => primaryBackground(dialog);

    let last = [null, null];
    const rebuild = (dateString = last[0], timeString = last[1]) => {
        last = [dateString, timeString];
        if (failed || !dateString || !timeString)
            return;
        const height = area.height, width = area.width;
        if (!(height > 0 && width > 0))
            return;
        try {
            glass ??= new GlassClock();
            if (!glass.actor.get_parent())
                area.add_child(glass.actor);
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const px = f => Math.round(f * height);
            const spec = {
                date: dateString, time: timeString,
                dateSize: px(DATE_SIZE) * scale, timeSize: px(TIME_SIZE) * scale,
                dateTop: GLASS_PAD * scale, gap: px(TIME_GAP) * scale,
            };
            const ink = measure(spec);
            const boxWidth = Math.ceil(ink.width / scale) + 2 * GLASS_PAD;
            const boxHeight = Math.ceil(ink.bottom / scale) + GLASS_PAD;
            const x = Math.round((width - boxWidth) / 2);
            const y = px(DATE_TOP) - GLASS_PAD;
            glass.actor.set_position(x, y);
            glass.actor.set_size(boxWidth, boxHeight);
            glass.setBackdrop(backgroundOf(), x, y);
            const dark = interfaceSettings.get_string('color-scheme') === 'prefer-dark';
            glass.setMask(buildMask(boxWidth * scale, boxHeight * scale, spec, scale),
                boxWidth * scale, boxHeight * scale, scale, dark, spec.timeSize / (MATERIAL.refSize * scale));
        } catch (e) {
            giveUp(`${e}`);
            return;
        }
        // hide the plain labels once the glass has really painted; else keep them
        if (verifyId)
            GLib.source_remove(verifyId);
        const before = glass.effect.paints;
        verifyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            verifyId = 0;
            if (!glass)
                return GLib.SOURCE_REMOVE;
            if (!glass.hasBackdrop)
                giveUp('no lock background to show through');
            else if (glass.effect.paints > before || labels.opacity === 0)
                labels.opacity = 0;
            else if (glass.actor.mapped)
                giveUp('the glass did not paint');
            return GLib.SOURCE_REMOVE;
        });
    };

    frame.connect(area, 'notify::size', () => rebuild());
    frame.connect(interfaceSettings, 'changed::color-scheme', () => rebuild());
    // GNOME rebuilds the backgrounds when monitors change: follow the new one
    frame.connect(dialog._backgroundGroup, 'child-added', () => glass?.setBackdrop(backgroundOf(), glass.actor.x, glass.actor.y));

    return {
        rebuild,
        get state() {
            return failed ? 'plain' : glass && labels.opacity === 0 ? 'glass' : 'starting';
        },
    };
}

// ---- the prompt: GNOME's own, moved down with a translation on its stack ----

function placePrompt(frame, dialog, nowPlaying = null) {
    const stack = dialog._stack;
    const mainBox = stack.get_parent();
    const notifications = dialog._notificationsBox;

    const place = () => {
        if (!mainBox)
            return;
        const height = mainBox.height;
        const avatarTop = Math.round(height * AVATAR_CENTRE - AVATAR_SIZE / 2);

        // Now Playing under the clock, then GNOME's notifications column under it, as on the
        // iPhone, when it fits above the prompt; else where GNOME put it, with the prompt above it
        const gap = Math.round(height * COLUMN_GAP);
        const underClock = Math.round(height * CLOCK_BOTTOM) + gap;
        nowPlaying?.place(Main.layoutManager.primaryMonitor, underClock);
        const columnTop = underClock + (nowPlaying?.height ? nowPlaying.height + gap : 0);
        let moved = false;
        if (notifications?.visible && notifications.height > 0) {
            const box = notifications.get_allocation_box();
            const top = columnTop;
            moved = top + box.get_height() <= avatarTop - Math.round(height * COLUMN_GAP);
            frame.setTranslationY(notifications, moved ? top - box.y1 : 0);
        }

        const prompt = dialog._authPrompt;
        const user = prompt?._userWell;
        if (!user)
            return;
        const stackY = stack.get_allocation_box().y1;
        const promptHeight = stack.get_allocation_box().get_height();
        let y = avatarTop - (stackY + layoutY(user, stack));
        // never past the bottom margin, and never over the notifications column if it stayed down
        let floor = height * (1 - BOTTOM_MARGIN);
        if (notifications?.visible && notifications.height > 0 && !moved)
            floor = Math.min(floor, notifications.get_allocation_box().y1);
        y = Math.min(y, Math.floor(floor - (stackY + promptHeight)));
        frame.setTranslationY(stack, Math.max(0, y));
    };
    // GNOME builds the prompt when the screen wakes and destroys it on the clock page; follow
    // the stack (it resizes through the crossfade), each new prompt (its avatar can load late)
    // and the notifications column (a player or a notification comes or goes)
    frame.connect(stack, 'notify::allocation', place);
    frame.connect(dialog._promptBox, 'child-added', (_box, child) => {
        frame.connect(child, 'notify::allocation', place);
        place();
    });
    if (dialog._authPrompt)
        frame.connect(dialog._authPrompt, 'notify::allocation', place);
    if (notifications) {
        frame.connect(notifications, 'notify::allocation', place);
        frame.connect(notifications, 'notify::visible', place);
    }
    place();
    return () => frame.guard(place);
}
