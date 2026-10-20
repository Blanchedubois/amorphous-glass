// The Tahoe proportions on any monitor (the theme's CSS is only a safe baseline, gdm/tahoe-gdm.css):
// - the clock (GNOME's panel clock, time only): digits 12 % of the monitor's height with their top
//   at 14.4 %, where tahoe-lockscreen's digits sit under its date;
// - the account rows and the password prompt low, the avatar's centre at 82.5 % of the height as
//   on the lock screen, never closer than 4 % to the bottom.
// LoginDialog centres the prompt and the user list in JS; top padding moves their content down by
// half of it. The padding is found by measuring: where GNOME put the avatar, then corrected once
// (no fixed numbers, so it holds for any monitor, font or avatar size). The prompt is also made
// wider than a third of the screen with empty side padding, or LoginDialog would move it into a
// right-hand column once its box reaches the banner area under the tall panel.
// Everything is set as inline styles on GNOME's actors and undone with the extension.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// the lock screen's clock, tahoe-lockscreen/layout.js (CLOCK.digits, DIGITS_EM, INK_TOP.time)
const CLOCK_DIGITS = 0.12;
const DIGITS_EM = 0.730;
const DIGITS_TOP = 0.1438;    // 207 px at 1440: under the lock screen's date
const INK_TOP = 0.270;        // the digits' top below the label's line top, of the type size
const INK_NUDGE = -3 / 1440;  // measured on the panel label (tools/gdm/run.sh): 3 px at 1440
const BAR = 32;               // the theme's own top bar height: the side boxes keep their content in it
const AVATAR_CENTRE = 0.825;
const BOTTOM_MARGIN = 0.04;
const LIST_BOTTOM = 40;       // the user list's bottom padding (tahoe-gdm.css)

function geometry() {
    const monitor = Main.layoutManager.primaryMonitor;
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    return {monitor, scale, W: monitor.width / scale, H: monitor.height / scale};
}

export function buildLayout(ext, dialog) {
    const styles = new Map();     // actor -> its own style, put back on undo
    const setStyle = (actor, css) => {
        if (!styles.has(actor))
            styles.set(actor, actor.style);
        actor.style = css;
    };
    ext._undo.push(() => {
        for (const [actor, style] of styles)
            actor.style = style;
        styles.clear();
    });

    const laters = global.compositor.get_laters();
    const pending = new Set();
    const later = fn => {
        const id = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            pending.delete(id);
            try {
                fn();
            } catch (e) {
                ext._fail(`layout: ${e}`);
            }
            return GLib.SOURCE_REMOVE;
        });
        pending.add(id);
    };
    ext._undo.push(() => {
        pending.forEach(id => laters.remove(id));
        pending.clear();
    });

    // ---- the clock ----
    const clock = Main.panel?.statusArea?.dateMenu?._clockDisplay;
    const sizeClock = () => {
        if (!clock)
            return;
        const {H, scale} = geometry();
        const size = Math.round(CLOCK_DIGITS / DIGITS_EM * H);
        const top = Math.round(DIGITS_TOP * H) - Math.round(INK_TOP * size) + Math.round(INK_NUDGE * H);
        setStyle(clock, `font-size: ${size}px; margin-top: ${Math.max(0, top)}px;`);
        const [, natHeight] = clock.get_preferred_height(-1);   // with the margin
        const bar = Math.ceil(natHeight / scale);
        setStyle(Main.panel, `height: ${bar}px;`);
        for (const box of [Main.panel._leftBox, Main.panel._rightBox])
            if (box)
                setStyle(box, `padding-bottom: ${Math.max(0, bar - BAR)}px;`);
    };

    // ---- the prompt and the account rows ----
    const prompt = dialog._authPrompt;
    const list = dialog._userSelectionBox;
    let promptTop = 0, promptSide = 0, listTop = 0;

    const centreOf = actor => {
        const [, y] = actor.get_transformed_position();
        return y + actor.height / 2;
    };
    // how far `anchor` may still move down: the content's bottom stays BOTTOM_MARGIN off the edge
    const target = (anchor, box, {monitor, H, scale}) => {
        const now = (centreOf(anchor) - monitor.y) / scale;
        const [, by] = box.get_transformed_position();
        const bottom = (by + box.height - monitor.y) / scale;
        return {now, want: Math.min(AVATAR_CENTRE * H, now + (H * (1 - BOTTOM_MARGIN) - bottom))};
    };

    const fitPrompt = () => {
        if (!prompt.visible || !prompt.mapped)
            return;
        const g = geometry();
        // wider than a third of the screen: no two-column layout
        const [, natWidth] = prompt.get_preferred_width(-1);
        const inner = natWidth / g.scale - 2 * promptSide;
        const side = Math.max(0, Math.ceil((g.W / 3 + 2 - inner) / 2));
        const avatar = prompt._userWell?.get_child?.()?._avatar;
        const anchor = avatar?.mapped ? avatar : prompt._entry;
        let top = promptTop;
        if (anchor?.mapped) {
            const {now, want} = target(anchor, prompt, g);
            // the entry alone (no avatar: a typed user name) sits where the avatar would
            if (Math.abs(want - now) >= 1)
                top = Math.max(0, Math.round(promptTop + 2 * (want - now)));
        }
        if (top !== promptTop || side !== promptSide) {
            promptTop = top;
            promptSide = side;
            setStyle(prompt, `padding: ${promptTop}px ${promptSide}px 0;`);
        }
        // the watchdog: the password field must be on the monitor
        const entry = prompt._entry;
        if (entry?.mapped) {
            const [ex, ey] = entry.get_transformed_position();
            const m = g.monitor;
            if (ey < m.y || ey + entry.height > m.y + m.height || ex < m.x || ex + entry.width > m.x + m.width)
                throw new Error('the password field is off the screen');
        }
    };

    const fitList = () => {
        if (!list?.visible || !list.mapped)
            return;
        const first = [...dialog._userList._items.values()][0];
        if (!first?.mapped)
            return;
        const g = geometry();
        const {now, want} = target(first, list, g);
        if (Math.abs(want - now) < 1)
            return;
        listTop = Math.max(0, Math.round(listTop + 2 * (want - now)));
        setStyle(list, `padding-top: ${listTop}px; padding-bottom: ${LIST_BOTTOM}px;`);
    };

    const refit = () => {
        sizeClock();
        // start from the theme's baseline each time the monitor changes
        for (const actor of [prompt, list])
            if (actor && styles.has(actor))
                actor.style = styles.get(actor);
        promptSide = 0;
        promptTop = prompt.get_theme_node().get_padding(St.Side.TOP) / geometry().scale;
        listTop = list?.get_theme_node().get_padding(St.Side.TOP) / geometry().scale || 0;
        later(fitPrompt);
        later(fitList);
    };

    const ids = [
        [prompt, prompt.connect('notify::allocation', () => later(fitPrompt))],
        [prompt, prompt.connect('notify::visible', () => later(fitPrompt))],
    ];
    if (list) {
        ids.push([list, list.connect('notify::allocation', () => later(fitList))]);
        ids.push([list, list.connect('notify::visible', () => later(fitList))]);
    }
    ids.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => later(refit))]);
    ext._undo.push(() => ids.forEach(([obj, id]) => obj.disconnect(id)));

    refit();
}
