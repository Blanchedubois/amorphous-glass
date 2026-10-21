// The Now Playing overlay (docs/NOWPLAYING_PLAN.md, Phase 1: the skeleton). One actor over every
// monitor, at the top of the shell's UI, holding a modal grab while it is open. It must never trap
// the user:
// 1. Escape always closes, even mid-animation;
// 2. every handler and timer runs through guard(): an exception tears the overlay down at once
//    (no animation), popping the grab;
// 3. a watchdog ends an enter or exit that has not finished WATCHDOG_MS after it started;
// 4. a lock, a session-mode change or a monitor change closes it at once (and disable() does);
// 5. if the grab is not really ours, the overlay does not open; if it is revoked, it goes;
// 6. on the way out the grab is released at the first frame and the overlay stops taking input,
//    so the desktop has it while the exit still plays;
// 7. the hotkey closes it again (keys.js).
// Phase 1 draws a plain dark field and the chevron; later phases fill it in.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Action, decide, parseAccelerator} from './keys.js';
import {symbolActor} from './symbols.js';

const ENTER_MS = 250;
const EXIT_MS = 200;
const WATCHDOG_MS = 3000;
const REF_HEIGHT = 1440;      // the sizes are given at 2560x1440 and scale with the monitor's height

const State = Object.freeze({OPENING: 'opening', OPEN: 'open', CLOSING: 'closing', CLOSED: 'closed'});

// the modal grab, replaceable by the test driver (to refuse it)
export const modal = {
    push: actor => Main.pushModal(actor, {actionMode: Shell.ActionMode.SYSTEM_MODAL}),
    pop: grab => Main.popModal(grab),
};

export class Overlay {
    // settings: the extension's; onClosed: called once, when the overlay is gone;
    // onAction: (action) => void, the player's keys and buttons (Phase 3 wires MPRIS)
    constructor({settings, onClosed, onAction}) {
        this._settings = settings;
        this._onClosed = onClosed;
        this._onAction = onAction;
        this._state = State.CLOSED;
        this._grab = null;
        this._signals = [];
        this._watchdog = 0;
        this.actor = null;
    }

    get state() {
        return this._state;
    }

    // runs fn; on an exception, logs it and removes the overlay at once
    guard(fn) {
        try {
            return fn();
        } catch (e) {
            console.error(`tahoe-nowplaying: ${e}\n${e?.stack ?? ''}`);
            this.teardown();
            return undefined;
        }
    }

    _connect(object, signal, handler) {
        const id = object.connect(signal, (...args) => this.guard(() => handler(...args)));
        this._signals.push([object, id]);
    }

    // true when it opened
    open() {
        if (this._state !== State.CLOSED)
            return false;
        if (Main.sessionMode.isLocked || Main.screenShield?.locked || Main.screenShield?.active)
            return false;

        const actor = new St.Widget({
            name: 'tahoe-nowplaying',
            style_class: 'tahoe-np-overlay',
            reactive: true,
            can_focus: true,
            layout_manager: new Clutter.FixedLayout(),
            opacity: 0,
        });
        actor.set_position(0, 0);
        actor.set_size(global.stage.width, global.stage.height);
        Main.layoutManager.uiGroup.add_child(actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(actor, null);
        this.actor = actor;

        // rule 5: the grab must really be ours (not revoked, the stage's grab actor), else nothing opens
        const grab = modal.push(actor);
        if (!grab || grab.is_revoked() || global.stage.get_grab_actor() !== actor) {
            if (grab)
                modal.pop(grab);
            actor.destroy();
            this.actor = null;
            return false;
        }
        this._grab = grab;
        this._state = State.OPENING;
        actor.grab_key_focus();

        this._buildChevron();

        this._accelerators = this._settings.get_strv('toggle').map(parseAccelerator).filter(Boolean);
        this._connect(actor, 'key-press-event', (_a, event) => this._onKey(event));
        this._connect(actor, 'button-press-event', (_a, event) => this._onPress(event));
        this._connect(actor, 'button-release-event', (_a, event) => this._onRelease(event));
        // a grab taken away leaves the view without input: it goes at once (our own release
        // clears this._grab first, so it does not count)
        this._connect(grab, 'notify::revoked', () => {
            if (this._grab === grab && grab.is_revoked())
                this.teardown();
        });
        this._connect(actor, 'destroy', () => {
            this.actor = null;
            this.teardown();
        });

        // rule 4: a lock, a session-mode change or a monitor change closes at once
        const shield = Main.screenShield;
        if (shield) {
            const locking = () => {
                if (shield.locked || shield.active)
                    this.teardown();
            };
            this._connect(shield, 'locked-changed', locking);
            this._connect(shield, 'active-changed', locking);
        }
        this._connect(Main.sessionMode, 'updated', () => {
            if (Main.sessionMode.isLocked || Main.sessionMode.currentMode !== 'user')
                this.teardown();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => this.teardown());

        this._armWatchdog();
        actor.ease({
            opacity: 255,
            duration: ENTER_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finished => this.guard(() => {
                if (finished && this._state === State.OPENING) {
                    this._state = State.OPEN;
                    this._disarmWatchdog();
                }
            }),
        });
        return true;
    }

    // the chevron: back to the desktop, bottom centre of the monitor the pointer is on
    _buildChevron() {
        const monitor = Main.layoutManager.monitors[global.display.get_current_monitor()] ?? Main.layoutManager.primaryMonitor;
        const k = Math.min(1.5, Math.max(0.75, monitor.height / REF_HEIGHT));
        const [w, h, bottom] = [112, 52, 34].map(v => Math.round(v * k));
        const chevron = new St.Button({
            style_class: 'tahoe-np-chevron',
            accessible_name: 'Back to the desktop',
            can_focus: false,
            child: symbolActor('chevron.down', Math.round(26 * k), 'go-down-symbolic'),
            width: w,
            height: h,
        });
        chevron._tahoeNpControl = true;
        chevron.set_position(monitor.x + Math.round((monitor.width - w) / 2), monitor.y + monitor.height - bottom - h);
        chevron.connect('clicked', () => this.guard(() => this.close()));
        this.actor.add_child(chevron);
        this.chevron = chevron;
    }

    _onKey(event) {
        if (this._state === State.CLOSING || this._state === State.CLOSED)
            return Clutter.EVENT_PROPAGATE;
        const action = decide(event.get_key_symbol(), event.get_state(), this._accelerators);
        this.lastKeyAction = action;
        switch (action) {
        case Action.CLOSE:
            this.close();
            return Clutter.EVENT_STOP;
        case Action.NONE:
            return Clutter.EVENT_STOP;
        case Action.PASS:
            return Clutter.EVENT_PROPAGATE;
        default:
            this._onAction?.(action);
            return Clutter.EVENT_STOP;
        }
    }

    // a control: the actor under the pointer or one of its parents is marked as one
    _isControl(event) {
        const [x, y] = event.get_coords();
        for (let a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y); a && a !== this.actor; a = a.get_parent()) {
            if (a._tahoeNpControl)
                return true;
        }
        return false;
    }

    // a click outside the controls closes on its release, so the whole click stays ours
    _onPress(event) {
        this._pressOutside = !this._isControl(event);
        return Clutter.EVENT_PROPAGATE;
    }

    _onRelease(event) {
        if (this._pressOutside && !this._isControl(event) && this._state !== State.CLOSING) {
            this._pressOutside = false;
            this.close();
            return Clutter.EVENT_STOP;
        }
        this._pressOutside = false;
        return Clutter.EVENT_PROPAGATE;
    }

    _armWatchdog() {
        this._disarmWatchdog();
        this._watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCHDOG_MS, () => {
            this._watchdog = 0;
            this.guard(() => {
                if (this._state === State.OPENING) {
                    console.warn('tahoe-nowplaying: the enter did not finish, jumping to its end');
                    this.actor?.remove_all_transitions();
                    if (this.actor)
                        this.actor.opacity = 255;
                    this._state = State.OPEN;
                } else if (this._state === State.CLOSING) {
                    console.warn('tahoe-nowplaying: the exit did not finish, removing the overlay');
                    this.teardown();
                }
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _disarmWatchdog() {
        if (this._watchdog)
            GLib.source_remove(this._watchdog);
        this._watchdog = 0;
    }

    _releaseGrab() {
        const grab = this._grab;
        this._grab = null;
        if (grab) {
            try {
                modal.pop(grab);
            } catch (e) {
                console.error(`tahoe-nowplaying: popModal: ${e}`);
            }
        }
    }

    // the exit: the grab goes at once (rule 6), then the fade, then teardown
    close() {
        if (this._state === State.CLOSED || this._state === State.CLOSING)
            return;
        this._state = State.CLOSING;
        this._releaseGrab();
        const actor = this.actor;
        if (!actor) {
            this.teardown();
            return;
        }
        actor.reactive = false;
        this._armWatchdog();
        actor.remove_all_transitions();
        actor.ease({
            opacity: 0,
            duration: EXIT_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => this.guard(() => this.teardown()),
        });
    }

    // removes everything at once; safe to call any number of times, from anywhere
    teardown() {
        if (this._state === State.CLOSED && !this.actor)
            return;
        this._state = State.CLOSED;
        this._disarmWatchdog();
        this._releaseGrab();
        const signals = this._signals;
        this._signals = [];
        for (const [object, id] of signals) {
            try {
                object.disconnect(id);
            } catch {}
        }
        const actor = this.actor;
        this.actor = null;
        this.chevron = null;
        if (actor) {
            actor.remove_all_transitions();
            actor.destroy();
        }
        const done = this._onClosed;
        this._onClosed = null;
        done?.();
    }
}
