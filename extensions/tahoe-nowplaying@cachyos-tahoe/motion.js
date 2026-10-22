// The view's clock (docs/NOWPLAYING_PLAN.md §3). Springs (tahoe-motion's spring.js) and fades step
// on the stage's frame clock (a Clutter.Timeline on the overlay, so every frame at 120 Hz) only
// while something moves; once all have settled, only the slow swirl is left, which ticks at
// IDLE_FPS on a plain timer; with nothing left at all, nothing runs. Steps use real elapsed time,
// so a dropped frame does not change a path.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Spring} from './shared/spring.js';

const IDLE_FPS = 25;      // the swirl is slow: 25 frames a second is plenty (the widgets' FPS)
const MAX_DT = 0.1;       // s: a long stall does not jump an animation to its end

export class Motion {
    // actor: the overlay (its frame clock); guard: the overlay's
    constructor(actor, guard) {
        this._guard = guard;
        this._springs = new Map();   // name -> {spring, apply}
        this._tasks = new Set();     // (dt) => true while it still has work
        this._idle = null;           // (dt) => void, the swirl's slow tick, or null
        this._last = 0;
        this.frames = 0;             // frames stepped on the frame clock (the tests read it)
        this._timeline = new Clutter.Timeline({actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._guard(() => this._frame()));
        this._idleId = 0;
    }

    static get animating() {
        return St.Settings.get().enable_animations;
    }

    // a spring named `name` toward target; apply(value) each step. token: {damping, stiffness}
    spring(name, from, target, token, apply) {
        let entry = this._springs.get(name);
        if (!entry) {
            entry = {spring: new Spring(from, token), apply};
            this._springs.set(name, entry);
        } else {
            entry.spring.setToken(token);
            entry.apply = apply;
        }
        entry.spring.retarget(target);
        if (!Motion.animating) {
            entry.spring.value = target;
            entry.spring.velocity = 0;
            entry.spring.settled = true;
            apply(target);
            return;
        }
        this._wake();
    }

    value(name) {
        return this._springs.get(name)?.spring.value;
    }

    // fn(dt) each frame until it returns false
    task(fn) {
        this._tasks.add(fn);
        this._wake();
    }

    // the swirl's slow tick (null: none); it also runs on the frame clock while that is going
    setIdle(fn) {
        this._idle = fn;
        this._sync();
    }

    get running() {
        return this._timeline.is_playing();
    }

    _wake() {
        if (!this._timeline.is_playing()) {
            this._last = GLib.get_monotonic_time();
            this._timeline.start();
        }
        this._sync();
    }

    _dt() {
        const now = GLib.get_monotonic_time();
        const dt = Math.min(MAX_DT, Math.max(0, (now - this._last) / 1e6));
        this._last = now;
        return dt;
    }

    _frame() {
        const dt = this._dt();
        this.frames++;
        for (const [name, entry] of this._springs) {
            const v = entry.spring.step(dt);
            entry.apply(v);
            if (entry.spring.settled)
                this._springs.delete(name);
        }
        for (const fn of [...this._tasks]) {
            if (!fn(dt))
                this._tasks.delete(fn);
        }
        this._idle?.(dt);
        if (!this._springs.size && !this._tasks.size) {
            this._timeline.stop();
            this._sync();
        }
    }

    // the idle timer runs only while the frame clock does not and there is an idle tick
    _sync() {
        const want = Boolean(this._idle) && !this._timeline.is_playing();
        if (want && !this._idleId) {
            this._last = GLib.get_monotonic_time();
            this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / IDLE_FPS), () => {
                this._guard(() => this._idle?.(this._dt()));
                if (this._idle && !this._timeline.is_playing())
                    return GLib.SOURCE_CONTINUE;
                this._idleId = 0;
                return GLib.SOURCE_REMOVE;
            });
        } else if (!want && this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
    }

    // ends every spring and task at its target at once (GNOME animations off, or a jump)
    finish() {
        for (const entry of this._springs.values())
            entry.apply(entry.spring.target);
        this._springs.clear();
        for (const fn of this._tasks)
            fn(Infinity);
        this._tasks.clear();
    }

    destroy() {
        this._timeline.stop();
        this._timeline.run_dispose();
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._springs.clear();
        this._tasks.clear();
        this._idle = null;
    }
}
