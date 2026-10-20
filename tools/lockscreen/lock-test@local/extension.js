// Headless lock screen test driver (scratch, never installed on the real desktop): locks a
// throwaway headless gnome-shell, opens the password prompt, types a fake string into the entry
// (never submitted), logs the geometry of the entry, the peek (eye) icon and the unlock arrow,
// which extensions and stylesheet are active while locked, takes screenshots, then ends the shell.
// Output dir: $TAHOE_TEST_OUT, names prefixed with $TAHOE_LOCK_TAG.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const FAULT = GLib.getenv('TAHOE_LOCK_FAULT');

// Fault injection: what a broken lock screen widget extension could do to GNOME's unlock dialog.
const ThrowingWidget = GObject.registerClass(class ThrowingWidget extends St.Widget {
    vfunc_allocate(box) { super.vfunc_allocate(box); throw new Error('injected: widget allocate'); }
});
const ThrowingLayout = GObject.registerClass(class ThrowingLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width() { return [0, 0]; }
    vfunc_get_preferred_height() { return [0, 0]; }
    vfunc_allocate() { throw new Error('injected: dialog layout allocate'); }
});

function inject(dialog) {
    switch (FAULT) {
    case 'widget-allocate':   // a widget whose allocation throws every layout pass
        dialog.add_child(new ThrowingWidget({ width: 300, height: 150, x: 100, y: 100, style: 'background-color: red;' }));
        break;
    case 'layout-allocate':   // a Tahoe layout manager on the dialog that throws
        dialog.layout_manager = new ThrowingLayout();
        break;
    case 'focus-steal': {      // a focusable widget button that takes key focus on lock
        const b = new St.Button({ label: 'widget', can_focus: true, reactive: true, x: 100, y: 100, style: 'background-color: red; padding: 20px;' });
        dialog.add_child(b);
        b.grab_key_focus();
        break;
    }
    case 'cover': {            // a reactive widget laid out over the password capsule
        const w = new St.Widget({ reactive: true, x: 1000, y: 780, width: 560, height: 160, style: 'background-color: rgba(255,0,0,0.5);' });
        dialog.add_child(w);
        dialog.connect('notify::allocation', () => dialog.set_child_above_sibling(w, null));
        break;
    }
    case 'timer-throws':       // a widget timer whose callback throws every 100 ms
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { throw new Error('injected: timer'); });
        break;
    case 'enable-throws':      // a lock screen extension whose enable() throws: see faulty-ext below
        break;
    }
}

async function typeKeys(text) {
    const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
    const kb = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    for (const ch of text) {
        const keyval = Clutter.unicode_to_keysym(ch.codePointAt(0));
        const t = GLib.get_monotonic_time();
        kb.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
        kb.notify_keyval(t + 1000, keyval, Clutter.KeyState.RELEASED);
        await sleep(60);
    }
}

async function runFault() {
    await sleep(3000);
    Main.screenShield.lock(false);
    await sleep(2500);
    Main.screenShield._wakeUpScreen();
    await sleep(800);
    const dialog = Main.screenShield._dialog;
    try { inject(dialog); } catch (e) { write({ label: 'inject-threw', error: String(e) }); }
    await sleep(500);
    const f0 = global.stage.key_focus;
    const inside = a => { for (; a; a = a.get_parent()) if (a === dialog) return true; return false; };
    write({ label: 'focus-before', focus: f0 ? f0.constructor.name : null, insideDialog: inside(f0) });
    // a real lock leaves key focus on the dialog (screenShield._ensureUnlockDialog); the headless
    // wake-up loses it, so put it back unless a widget inside the dialog took it
    if (!inside(f0))
        dialog.grab_key_focus();
    // from the clock page, as a person would: just start typing
    const typed = 'fakepass';
    await typeKeys(typed);
    await sleep(1500);
    const prompt = dialog._authPrompt;
    if (prompt && !prompt._entryArea.visible) { prompt.setQuestion('Enter Password'); await sleep(600); }
    const entry = prompt?._entry;
    const b = box(entry);
    const at = b ? global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, b[0] + b[2] / 2, b[1] + b[3] / 2) : null;
    let chainOpacity = 255, a = entry;
    while (a) { chainOpacity = Math.min(chainOpacity, a.opacity); a = a.get_parent(); }
    write({ label: 'fault', fault: FAULT, page: dialog._activePage === dialog._promptBox ? 'prompt' : 'clock',
        entryText: entry?.text === typed ? 'all typed keys arrived' : `got ${entry?.text?.length ?? 'no entry'} of ${typed.length}`,
        entryBox: b, entryMapped: entry?.mapped ?? false, chainOpacity,
        hitAtEntry: at === entry ? 'entry' : `${at?.constructor?.name}`,
        keyFocus: global.stage.key_focus === entry ? 'entry' : `${global.stage.key_focus?.constructor?.name}`,
        dialogBox: box(dialog), stillLocked: Main.sessionMode.isLocked });
    await shotRect('fault', [0, 0, global.screen_width, global.screen_height]);
}

const OUT = GLib.getenv('TAHOE_TEST_OUT');
const TAG = GLib.getenv('TAHOE_LOCK_TAG') ?? 'lock';
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

function write(obj) {
    const f = Gio.File.new_for_path(`${OUT}/log-${TAG}.jsonl`);
    const s = f.append_to(Gio.FileCreateFlags.NONE, null);
    s.write_all(new TextEncoder().encode(JSON.stringify(obj) + '\n'), null);
    s.close(null);
}

async function shotRect(name, [x, y, w, h]) {
    const file = Gio.File.new_for_path(`${OUT}/${TAG}-${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(x, y, w, h, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

function box(actor) {
    if (!actor || !actor.mapped) return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
}

function state(label) {
    const em = Main.extensionManager;
    const exts = {};
    for (const uuid of em.getUuids()) exts[uuid] = em.lookup(uuid)?.state;
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    write({ label, mode: Main.sessionMode.currentMode, locked: Main.sessionMode.isLocked,
        exts, themeStylesheet: theme?.application_stylesheet?.get_path?.() ?? null,
        themeDefault: theme?.default_stylesheet?.get_path?.() ?? null,
        themeCustom: theme?.get_custom_stylesheets?.().map(f => f.get_path()) ?? null });
}

async function run() {
    await sleep(3000);
    state('unlocked');
    await shotRect('unlocked', [0, 0, global.screen_width, global.screen_height]);
    Main.screenShield.lock(false);
    await sleep(2500);
    state('locked');
    const shield = Main.screenShield;
    write({ label: 'shield', group: box(Main.layoutManager.screenShieldGroup), visible: Main.layoutManager.screenShieldGroup.visible,
        opacity: Main.layoutManager.screenShieldGroup.opacity, dialog: box(shield._dialog), dialogOpacity: shield._dialog?.opacity,
        lockDialogGroup: box(shield._lockDialogGroup), ldgOpacity: shield._lockDialogGroup.opacity,
        shortLightbox: shield._shortLightbox?.visible, longLightbox: shield._longLightbox?.visible,
        bgs: shield._dialog?._backgroundGroup?.get_n_children() });
    // a locked shell fades to black until the user moves; wake it the way a keypress does
    Main.screenShield._wakeUpScreen();
    await sleep(800);
    const dialog = Main.screenShield._dialog;
    dialog._showPrompt();
    await sleep(1500);
    const prompt = dialog._authPrompt;
    if (!prompt._entryArea.visible) {
        // no GDM conversation in the throwaway shell: show the entry the way a password question does
        prompt.setQuestion('Enter Password');
        write({ label: 'setQuestion', note: 'entry shown without a verifier question' });
    }
    await sleep(800);
    prompt._entry.text = GLib.getenv('TAHOE_LOCK_TEXT') ?? 'not-a-password';
    await sleep(800);
    const entry = prompt._entry;
    const peek = entry.get_secondary_icon?.() ?? null;
    write({ label: 'geometry', entry: box(entry), entryArea: box(prompt._entryArea),
        peek: box(peek), peekReactive: peek?.reactive ?? null,
        well: box(prompt._defaultButtonWell), next: box(prompt._nextButton),
        nextOpacity: prompt._nextButton.opacity, hint: entry.hint_text,
        entryStyle: entry.get_theme_node().get_padding(St.Side.RIGHT) });
    // what a click at each icon's centre would hit
    const hit = b => {
        if (!b) return null;
        const a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, b[0] + b[2] / 2, b[1] + b[3] / 2);
        return a === peek ? 'peek' : a === prompt._nextButton ? 'next' : a === entry ? 'entry' : `${a?.constructor?.name}.${a?.style_class ?? ''}`;
    };
    write({ label: 'hit', atPeek: hit(box(peek)), atNext: hit(box(prompt._nextButton)) });
    const [sw, sh] = [global.screen_width, global.screen_height];
    await shotRect('full', [0, 0, sw, sh]);
    const a = box(prompt._entryArea);
    if (a) await shotRect('entry', [a[0] - 40, a[1] - 40, a[2] + 80, a[3] + 80]);
    const c = box(dialog._clock);
    if (c) write({ label: 'clock', clock: c });
    // the clock page too (Escape-equivalent): back to the clock, settle, shoot
    dialog._showClock();
    await sleep(1200);
    await shotRect('clock', [0, 0, sw, sh]);
}

export default class Driver extends Extension {
    enable() {
        if (this._started) return;
        this._started = true;
        (FAULT ? runFault() : run()).catch(e => write({ label: 'error', error: String(e), stack: e.stack }))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
    }
    disable() {}
}
