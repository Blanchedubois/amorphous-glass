// The safety frame every lock screen change goes through (docs/LOCKSCREEN_PLAN.md, Phase 2).
//
// GNOME's unlock dialog does all of the authentication; this extension only adds actors, moves
// GNOME's with translations and loads a stylesheet. Every one of those changes is made through
// the frame, which records how to undo it. If anything goes wrong (an exception in our code, or
// the watchdog finding the password field hidden, covered, off screen or unclickable), the frame
// undoes everything and stays dormant until the next lock, leaving GNOME's own lock screen.
//
// The frame never touches AuthPrompt, the user verifier, the shield's lock state, key focus or
// the dialog's layout manager.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

// GNOME versions this extension was tested on. disable-extension-version-validation is on
// (tahoe-repair sets it), so metadata.json's shell-version does not protect us on an upgrade.
const TESTED_MAJORS = [51];

// The private parts of GNOME's lock screen the extension relies on, checked before any change.
const DIALOG_MEMBERS = ['_stack', '_clock', '_promptBox', '_backgroundGroup', '_adjustment'];

// Watchdog timing: GNOME's page crossfade and the prompt's fade-in take 300 ms each.
const CHECK_DELAY_MS = 450;
const MAX_UNSETTLED_CHECKS = 8;   // about 3.6 s of fading before an unsettled prompt is a failure

// Minimum size of a usable password field, logical px (Phase 1's capsule is 243 x 48).
const MIN_ENTRY_WIDTH = 200;
const MIN_ENTRY_HEIGHT = 30;

const OUR_NAME = 'tahoe-lock';

// Properties GNOME sets on every frame of its clock-to-prompt crossfade
// (UnlockDialog._setTransitionProgress). Changing them would be overwritten mid-animation and
// undone to a stale value, so the frame refuses: move or hide something else (the stack, a
// label) instead.
const ANIMATED_BY_GNOME = {
    _promptBox: ['opacity', 'scale_x', 'scale_y', 'translation_y', 'visible'],
    _clock: ['opacity', 'scale_x', 'scale_y', 'translation_y', 'visible'],
    _bottomButtonGroup: ['opacity', 'scale_x', 'scale_y'],
    _authIndicatorButton: ['opacity', 'scale_x', 'scale_y'],
};

function log(message) {
    console.warn(`tahoe-lockscreen: ${message}`);
}

// Knows when an actor is destroyed, so undo never touches a disposed object (the dialog and its
// children are destroyed by GNOME at unlock, possibly before our extension is disabled).
class Watch {
    // target: an actor, or an effect or constraint (watched through the actor it is on)
    constructor(target) {
        this.actor = target instanceof Clutter.Actor ? target : target.get_actor?.() ?? null;
        this.gone = !this.actor;
        this._id = this.actor?.connect('destroy', () => (this.gone = true)) ?? 0;
    }

    release() {
        if (!this.gone && this._id)
            this.actor.disconnect(this._id);
    }
}

export function versionSupported() {
    const major = Number.parseInt(Config.PACKAGE_VERSION, 10);
    return TESTED_MAJORS.includes(major);
}

export class Frame {
    constructor(stylesheet) {
        this._stylesheet = stylesheet;  // Gio.File
        this._undo = [];                // whole-session changes, undone last-in first-out
        this._dialogUndo = [];          // changes tied to the current dialog
        this._dialog = null;
        this._checks = [];              // extra watchdog checks, per dialog
        this._builders = [];            // fn(frame, dialog), run for each unlock dialog
        this._checkId = 0;
        this._unsettled = 0;
        this.failed = false;
        this.reason = null;
    }

    // Register what to build on each unlock dialog (GNOME can replace the dialog while locked).
    // Call before start(). A builder that throws sends the lock screen back to GNOME's own.
    onDialog(builder) {
        this._builders.push(builder);
    }

    // Start watching for GNOME's unlock dialog. Throws if the shield is not shaped as expected;
    // the extension catches that and calls stop().
    start() {
        const shield = Main.screenShield;
        const group = shield?._lockDialogGroup;
        if (!group)
            throw new Error('Main.screenShield._lockDialogGroup is missing');

        this._loadStylesheet();

        group.connectObject('child-added', (_group, child) => this.guard(() => this._attach(child)), this);
        this._undo.push(() => group.disconnectObject(this));

        if (shield._dialog)
            this._attach(shield._dialog);
    }

    // Undo every change and stop watching. Safe to call more than once, and after the dialog
    // was destroyed.
    stop() {
        this._cancelCheck();
        this._detach();
        for (const undo of this._undo.splice(0).reverse()) {
            try {
                undo();
            } catch (e) {
                log(`undo failed: ${e}`);
            }
        }
    }

    // Run fn; any exception sends the lock screen back to GNOME's own until the next lock.
    guard(fn) {
        if (this.failed)
            return undefined;
        try {
            return fn();
        } catch (e) {
            this.fail(`${e}`);
            return undefined;
        }
    }

    fail(reason) {
        if (this.failed)
            return;
        this.failed = true;
        this.reason = reason;
        log(`${reason}; back to GNOME's lock screen until the next lock`);
        this.stop();
    }

    get dialog() {
        return this._dialog;
    }

    // ---- changes, each recorded with its undo ----

    // Add one of our actors to a parent inside the dialog.
    addActor(parent, actor) {
        actor.name = actor.name ? `${OUR_NAME}:${actor.name}` : OUR_NAME;
        parent.add_child(actor);
        const watch = new Watch(actor);
        this._dialogUndo.push(() => {
            watch.release();
            if (!watch.gone)
                actor.destroy();
        });
        this.scheduleCheck();
        return actor;
    }

    // Set a property on one of GNOME's actors; the first change remembers the old value for undo.
    // Errors (see ANIMATED_BY_GNOME) send the lock screen back to GNOME's own.
    set(actor, prop, value) {
        this.guard(() => {
            this._remember(actor, prop);
            if (actor[prop] !== value) {
                actor[prop] = value;
                this.scheduleCheck();
            }
        });
    }

    // Move one of GNOME's actors without changing GNOME's layout: translations are not part of
    // the allocation, so GNOME's own geometry stays as it computed it.
    setTranslationY(actor, y) {
        this.set(actor, 'translation_y', y);
    }

    // Hide one of GNOME's actors by opacity, keeping it in place.
    hide(actor) {
        this.set(actor, 'opacity', 0);
    }

    // Connect to a signal for as long as the current dialog lives; the handler runs guarded.
    connect(gobject, signal, handler) {
        const token = {};
        const watch = gobject instanceof Clutter.Actor ? new Watch(gobject) : null;
        gobject.connectObject(signal, (...args) => this.guard(() => handler(...args)), token);
        this._dialogUndo.push(() => {
            watch?.release();
            if (!watch?.gone)
                gobject.disconnectObject(token);
        });
    }

    // Anything else to undo when the dialog goes or the frame stops.
    addUndo(fn) {
        this._dialogUndo.push(fn);
    }

    // record a property's value before our first change to it, and how to put it back
    _remember(actor, prop) {
        for (const [member, props] of Object.entries(ANIMATED_BY_GNOME)) {
            if (this._dialog?.[member] === actor && props.includes(prop))
                throw new Error(`GNOME animates ${member}.${prop}; change something else`);
        }
        if (this._dialogUndo.some(u => u.actor === actor && u.prop === prop))
            return;
        const before = actor[prop];
        const watch = new Watch(actor);
        const undo = () => {
            watch.release();
            if (!watch.gone)
                actor[prop] = before;
        };
        undo.actor = actor;
        undo.prop = prop;
        this._dialogUndo.push(undo);
    }

    // A later phase's own invariant, run by the watchdog on the settled dialog: fn(dialog)
    // returns null when fine, else what is wrong.
    addCheck(name, fn) {
        this._checks.push({name, fn});
    }

    // ---- the dialog ----

    _attach(dialog) {
        if (dialog === this._dialog || this.failed)
            return;
        if (!dialog?.constructor?.name?.includes('UnlockDialog'))
            return;
        const missing = DIALOG_MEMBERS.filter(m => !(m in dialog));
        if (missing.length) {
            this.fail(`the unlock dialog has changed (missing ${missing.join(', ')})`);
            return;
        }
        this._detach();
        this._dialog = dialog;

        dialog.connectObject(
            'destroy', () => this._detach(true),
            'notify::allocation', () => this.scheduleCheck(),
            this);
        dialog._adjustment.connectObject('notify::value', () => this.scheduleCheck(), this);
        dialog._promptBox.connectObject(
            'child-added', () => this.scheduleCheck(),
            'notify::visible', () => this.scheduleCheck(),
            this);
        for (const build of this._builders) {
            if (this.failed)
                return;
            build(this, dialog);
        }
        this.scheduleCheck();
    }

    _detach(destroyed = false) {
        const dialog = this._dialog;
        this._dialog = null;
        for (const undo of this._dialogUndo.splice(0).reverse()) {
            try {
                undo();
            } catch (e) {
                log(`undo failed: ${e}`);
            }
        }
        this._checks = [];
        if (dialog && !destroyed) {
            try {
                dialog.disconnectObject(this);
                dialog._adjustment.disconnectObject(this);
                dialog._promptBox.disconnectObject(this);
            } catch (e) {
                log(`disconnect failed: ${e}`);
            }
        }
    }

    _loadStylesheet() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(this._stylesheet);
        this._undo.push(() => {
            // the shell carries custom stylesheets over when it reloads the theme, so unload
            // from whichever theme is current
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._stylesheet);
        });
    }

    // ---- the watchdog ----

    scheduleCheck() {
        if (this.failed || !this._dialog)
            return;
        this._cancelCheck();
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_DELAY_MS, () => {
            this._checkId = 0;
            this.guard(() => this._check());
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelCheck() {
        if (this._checkId) {
            GLib.source_remove(this._checkId);
            this._checkId = 0;
        }
    }

    // What is wrong with the settled dialog, or null. 'unsettled' means a fade is still running.
    inspect() {
        const dialog = this._dialog;
        if (!dialog)
            return null;
        const page = dialog._adjustment.value;
        if (page !== Math.round(page))
            return 'unsettled';

        const prompt = dialog._authPrompt;
        if (page === 1 && prompt && prompt._entryArea?.visible) {
            const problem = this._inspectPrompt(prompt);
            if (problem)
                return problem;
        }
        for (const {name, fn} of this._checks) {
            const problem = fn(dialog);
            if (problem)
                return `${name}: ${problem}`;
        }
        return null;
    }

    _inspectPrompt(prompt) {
        const entry = prompt._entry;
        if (!entry?.mapped)
            return 'the password field is not shown';
        for (let a = entry; a; a = a.get_parent()) {
            if (a.opacity < 255)
                return 'unsettled';
        }
        const [x, y] = entry.get_transformed_position();
        const [w, h] = entry.get_transformed_size();
        if (![x, y, w, h].every(Number.isFinite))
            return 'the password field has no position';
        if (w < MIN_ENTRY_WIDTH || h < MIN_ENTRY_HEIGHT)
            return `the password field is ${Math.round(w)}x${Math.round(h)}`;
        const cx = x + w / 2, cy = y + h / 2;
        const onScreen = Main.layoutManager.monitors.some(m =>
            x >= m.x && y >= m.y && x + w <= m.x + m.width && y + h <= m.y + m.height);
        if (!onScreen)
            return 'the password field is off screen';
        if (!this._hits(entry, cx, cy))
            return 'something covers the password field';

        const next = prompt._nextButton;
        if (next?.mapped && next.opacity === 255 && !this._hitsCentre(next))
            return 'something covers the unlock arrow';
        const peek = entry.get_secondary_icon?.();
        if (peek?.mapped && peek.visible && !this._hitsCentre(peek))
            return 'something covers the show-password eye';
        return null;
    }

    _hitsCentre(actor) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return this._hits(actor, x + w / 2, y + h / 2);
    }

    _hits(actor, x, y) {
        const hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        return hit !== null && (hit === actor || actor.contains(hit));
    }

    _check() {
        const problem = this.inspect();
        if (problem === 'unsettled') {
            if (++this._unsettled > MAX_UNSETTLED_CHECKS)
                this.fail('the lock screen did not settle');
            else
                this.scheduleCheck();
            return;
        }
        this._unsettled = 0;
        if (problem)
            this.fail(problem);
    }
}
