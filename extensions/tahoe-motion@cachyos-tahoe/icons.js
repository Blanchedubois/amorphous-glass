// Icon effects for quick settings (docs/gnome-tahoe/motion-implementation.md, Phase D): the
// SF Symbols Bounce and Replace effects, built on springs, for the icons the shell already has.
//
// - Bounce, on press: the icon is given a push (a velocity, not a scripted curve): it dips and
//   springs back past its size, settling on a spatial fast spring.
// - Replace, when a toggle turns on or off: the icon shrinks and fades, then grows back in its
//   new state with a little overshoot.
// - Squish, while a button is held: after Material's switch (material-web, switch/internal/
//   _handle.scss: the pressed handle changes size over 100 ms, then springs to its state with an
//   overshoot), the whole button, glass included, gives a little under the finger (wider, shorter)
//   and springs back past its size when released.
// - Pop, when an icon changes by itself (a volume level, a Wi-Fi strength): a gentle nudge, at
//   most every POP_EVERY_MS, so dragging a slider does not strobe.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { EXPRESSIVE, Spring } from './spring.js';

const BOUNCE_PUSH = -7;
const REPLACE_TO = 0.55;
const POP_PUSH = -3;
const POP_EVERY_MS = 400;

function findIcon(actor) {
    if (actor instanceof St.Icon)
        return actor;
    for (const child of actor.get_children()) {
        const icon = findIcon(child);
        if (icon)
            return icon;
    }
    return null;
}

/// The springs of one icon, run on the icon's own frame clock while they move.
class IconMotion {
    constructor(icon) {
        this.icon = icon;
        this.scale = new Spring(1, EXPRESSIVE.spatial.fast);
        this.fade = new Spring(1, EXPRESSIVE.effects.fast);
        this.scale.settled = this.fade.settled = true;
        this.lastPop = 0;
    }

    bounce(push = BOUNCE_PUSH) {
        // a toggle that was just switched shows its replace instead
        if (this.replacing)
            return;
        this.scale.setToken(EXPRESSIVE.spatial.fast);
        this.scale.velocity += push;
        this.scale.retarget(1, 0.3);
        this.run();
    }

    replace() {
        // shrink and fade without bouncing, then grow back (see frame())
        this.replacing = true;
        this.scale.setToken({ damping: 1, stiffness: EXPRESSIVE.effects.default.stiffness });
        this.scale.retarget(REPLACE_TO, 1 - REPLACE_TO);
        this.fade.setToken(EXPRESSIVE.effects.fast);
        this.fade.retarget(0.25, 0.75);
        this.run();
    }

    pop() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this.replacing || now - this.lastPop < POP_EVERY_MS)
            return;
        this.lastPop = now;
        this.bounce(POP_PUSH);
    }

    run() {
        if (this.timeline)
            return;
        this.last = 0;
        this.timeline = new Clutter.Timeline({ actor: this.icon, duration: 5000 });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.connect('completed', () => this.stop());
        this.timeline.start();
    }

    frame() {
        const now = this.timeline.get_elapsed_time() / (St.Settings.get().slow_down_factor || 1);
        const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.scale.step(dt);
        this.fade.step(dt);
        if (this.replacing && Math.abs(this.scale.value - REPLACE_TO) < 0.04) {
            this.replacing = false;
            this.scale.setToken(EXPRESSIVE.spatial.fast);
            this.scale.retarget(1, 1 - REPLACE_TO);
            this.fade.setToken(EXPRESSIVE.effects.default);
            this.fade.retarget(1, 0.75);
        }
        const icon = this.icon;
        icon.set_pivot_point(0.5, 0.5);
        icon.set_scale(this.scale.value, this.scale.value);
        icon.opacity = Math.round(255 * Math.min(1, Math.max(0, this.fade.value)));
        if (!this.replacing && this.scale.settled && this.fade.settled)
            this.stop();
    }

    stop() {
        this.replacing = false;
        this.timeline?.stop();
        this.timeline?.run_dispose();
        this.timeline = null;
        this.icon.set_scale(1, 1);
        this.icon.opacity = 255;
    }
}

// held: a little wider, a little shorter (a liquid keeps its volume)
const PRESSED = [1.035, 0.92];
const PRESS = { damping: 1, stiffness: EXPRESSIVE.effects.fast.stiffness };

/// A button that gives under the finger, on its own frame clock while it moves.
class Squish {
    constructor(button) {
        this.button = button;
        this.x = new Spring(1, PRESS);
        this.y = new Spring(1, PRESS);
        this.x.settled = this.y.settled = true;
    }

    press(down) {
        const [px, py] = down ? PRESSED : [1, 1];
        const token = down ? PRESS : EXPRESSIVE.spatial.fast;
        this.x.setToken(token);
        this.y.setToken(token);
        this.x.retarget(px, 0.05);
        this.y.retarget(py, 0.05);
        if (this.timeline)
            return;
        this.last = 0;
        this.timeline = new Clutter.Timeline({ actor: this.button, duration: 5000 });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.connect('completed', () => this.stop());
        this.timeline.start();
    }

    frame() {
        const now = this.timeline.get_elapsed_time() / (St.Settings.get().slow_down_factor || 1);
        const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.x.step(dt);
        this.y.step(dt);
        this.button.set_pivot_point(0.5, 0.5);
        this.button.set_scale(this.x.value, this.y.value);
        if (this.x.settled && this.y.settled && this.x.target === 1)
            this.stop();
    }

    stop() {
        this.timeline?.stop();
        this.timeline?.run_dispose();
        this.timeline = null;
        this.button.set_scale(1, 1);
    }
}

export class IconEffects {
    constructor(isBusy) {
        // no effects while the panel itself is arriving or leaving (tahoe-motion animates it)
        this.isBusy = isBusy;
        this.motions = new Map();
        this.tracked = new Set();
        this.icons = new Set();
        this.squishes = new Map();
    }

    /// watches the buttons of a quick settings panel (new ones too, each time it opens)
    track(quickSettings) {
        const grid = quickSettings?._grid;
        if (!grid)
            return;
        const buttons = [];
        const visit = actor => {
            for (const child of actor.get_children()) {
                if (child instanceof St.Button)
                    buttons.push(child);
                else
                    visit(child);
            }
        };
        visit(grid);
        for (const button of buttons) {
            if (this.tracked.has(button))
                continue;
            const icon = findIcon(button);
            if (!icon)
                continue;
            this.tracked.add(button);
            this.icons.add(icon);
            const motion = () => {
                let m = this.motions.get(icon);
                if (!m) {
                    m = new IconMotion(icon);
                    this.motions.set(icon, m);
                }
                return m;
            };
            button.connectObject(
                'clicked', () => !this.isBusy() && motion().bounce(),
                'destroy', () => {
                    this.squishes.get(button)?.stop();
                    this.squishes.delete(button);
                    this.tracked.delete(button);
                    this.icons.delete(icon);
                    this.motions.get(icon)?.stop();
                    this.motions.delete(icon);
                },
                this);
            button.connectObject('notify::pressed', () => {
                if (this.isBusy())
                    return;
                let squish = this.squishes.get(button);
                if (!squish) {
                    squish = new Squish(button);
                    this.squishes.set(button, squish);
                }
                squish.press(button.pressed);
            }, this);
            if ('checked' in button)
                button.connectObject('notify::checked', () => !this.isBusy() && motion().replace(), this);
            icon.connectObject(
                'notify::gicon', () => !this.isBusy() && motion().pop(),
                'notify::icon-name', () => !this.isBusy() && motion().pop(),
                this);
        }
    }

    destroy() {
        for (const button of this.tracked)
            button.disconnectObject(this);
        for (const icon of this.icons)
            icon.disconnectObject(this);
        for (const motion of this.motions.values())
            motion.stop();
        for (const squish of this.squishes.values())
            squish.stop();
        this.squishes.clear();
        this.icons.clear();
        this.tracked.clear();
        this.motions.clear();
    }
}
