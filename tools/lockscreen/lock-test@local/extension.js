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
const GATE = GLib.getenv('TAHOE_LOCK_GATE');   // ours-<fault> | churn
const LOCK_UUID = 'tahoe-lockscreen@cachyos-tahoe';

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

function lockExt() {
    return Main.extensionManager.lookup(LOCK_UUID);
}

function frameState() {
    const ext = lockExt();
    const frame = ext?.stateObj?._frame ?? null;
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const sheets = theme.get_custom_stylesheets().map(f => f.get_path()).filter(p => p.endsWith('/lockscreen.css'));
    let ours = 0;
    const walk = a => { if (a.name?.startsWith('tahoe-lock')) ours++; for (const c of a.get_children()) walk(c); };
    walk(global.stage);
    return { extState: ext?.state ?? null, frame: frame ? (frame.failed ? `failed: ${frame.reason}` : 'running') : null,
        stylesheetLoaded: sheets.length, ourActors: ours };
}

function countActors(a = global.stage) {
    let n = 1;
    for (const c of a.get_children()) n += countActors(c);
    return n;
}

function rssKb() {
    const [, bytes] = GLib.file_get_contents('/proc/self/status');
    const m = new TextDecoder().decode(bytes).match(/VmRSS:\s+(\d+)/);
    return m ? Number(m[1]) : null;
}

// G1: is the password field usable? Clears it, types the fake string, checks it all arrived, is
// visible, on screen and what a click at its centre hits.
async function usable(dialog) {
    const prompt = dialog._authPrompt;
    if (prompt && !prompt._entryArea.visible) { prompt.setQuestion('Enter Password'); await sleep(600); }
    const entry = prompt?._entry;
    if (!entry) return { entry: 'none' };
    entry.text = '';
    entry.grab_key_focus();
    const typed = 'fakepass';
    await typeKeys(typed);
    await sleep(500);
    const b = box(entry);
    const at = b ? global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, b[0] + b[2] / 2, b[1] + b[3] / 2) : null;
    let chainOpacity = 255;
    for (let a = entry; a; a = a.get_parent()) chainOpacity = Math.min(chainOpacity, a.opacity);
    const onScreen = b && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= global.screen_width && b[1] + b[3] <= global.screen_height;
    return { keys: entry.text === typed ? 'all arrived' : `${entry.text.length} of ${typed.length}`,
        visible: entry.mapped && chainOpacity === 255, onScreen: !!onScreen,
        clickHits: at === entry || entry.contains(at) ? 'entry' : `${at?.constructor?.name}`,
        stillLocked: Main.sessionMode.isLocked };
}

async function lockAndPrompt() {
    Main.screenShield.lock(false);
    await sleep(2000);
    Main.screenShield._wakeUpScreen();
    await sleep(600);
    const dialog = Main.screenShield._dialog;
    const f0 = global.stage.key_focus;
    let inside = false;
    for (let a = f0; a; a = a.get_parent()) if (a === dialog) inside = true;
    if (!inside) dialog.grab_key_focus();
    await typeKeys('x');       // the first key opens the prompt, as for a person
    await sleep(1500);
    return dialog;
}

// Frame cost: page changes (clock <-> password) while locked, the moments the glass repaints with
// the whole lock screen. Logs the time each stage update takes and the frame intervals.
async function runPerf() {
    await sleep(3000);
    const dialog = await lockAndPrompt();
    await sleep(1000);
    const updates = [], intervals = [];
    let t0 = 0, last = 0;
    const ids = [
        global.stage.connect('before-update', () => { t0 = GLib.get_monotonic_time(); }),
        global.stage.connect('after-update', () => {
            const now = GLib.get_monotonic_time();
            if (t0) updates.push((now - t0) / 1000);
            if (last) intervals.push((now - last) / 1000);
            last = now;
        }),
    ];
    for (let i = 0; i < 10; i++) {
        dialog._showClock();
        await sleep(700);
        dialog._showPrompt();
        await sleep(700);
    }
    ids.forEach(id => global.stage.disconnect(id));
    const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return Math.round(b[Math.min(b.length - 1, Math.floor(q * b.length))] * 100) / 100; };
    write({ label: 'perf', frames: updates.length, updateP50: pct(updates, 0.5), updateP95: pct(updates, 0.95), updateMax: pct(updates, 1),
        intervalP95: pct(intervals.filter(x => x < 50), 0.95), frame: frameState().frame });
}

// G2 for our own code: a broken later phase, injected through the frame's own API
async function runOurs(kind) {
    await sleep(3000);
    const dialog = await lockAndPrompt();
    const before = { ...frameState(), ...(await usable(dialog)) };
    await sleep(800);
    const frame = lockExt()?.stateObj?._frame;
    write({ label: 'ours-before', kind, ...before, frameAfterTyping: frameState().frame });
    try {
        switch (kind) {
        case 'cover': {          // over the password field, wherever the layout put it
            const [ex, ey] = dialog._authPrompt._entry.get_transformed_position();
            const w = new St.Widget({ reactive: true, x: ex - 40, y: ey - 40, width: 320, height: 130, style: 'background-color: rgba(255,0,0,0.5);' });
            frame.addActor(dialog, w);
            break;
        }
        case 'offscreen':
            frame.setTranslationY(dialog._stack, 3000);
            break;
        case 'hide-prompt':
            frame.hide(dialog._stack);
            break;
        case 'animated-prop':   // a design mistake: a property GNOME animates
            frame.setTranslationY(dialog._promptBox, 40);
            break;
        case 'throw':
            frame.addActor(dialog, new St.Widget({ name: 'leftover', width: 10, height: 10 }));
            frame.guard(() => { throw new Error('test: exception in our code'); });
            break;
        case 'clock-broken': {   // our clock laid out too narrow: the clock check must catch it
            const area = dialog.get_children().find(c => c.name === 'tahoe-lock:clock-area');
            const time = area.get_first_child().get_last_child();
            time.width = 10;
            frame.scheduleCheck();
            break;
        }
        case 'check-fails':
            frame.addCheck('test clock', () => 'our clock is not shown');
            frame.scheduleCheck();
            break;
        case 'enable-fails': {
            const ext = lockExt().stateObj;
            ext.disable();
            ext._failAfterStartForTest = true;
            ext.enable();
            delete ext._failAfterStartForTest;
            break;
        }
        }
    } catch (e) {
        write({ label: 'inject-threw', error: String(e) });
    }
    await sleep(5500);
    const after = { ...frameState(), ...(await usable(dialog)) };
    write({ label: 'ours-after', kind, ...after, stackTranslation: dialog._stack.translation_y, stackOpacity: dialog._stack.opacity,
        promptTranslation: dialog._promptBox.translation_y, promptOpacity: dialog._promptBox.opacity,
        gnomeClockLabels: ['_time', '_date', '_hint'].map(n => dialog._clock[n].visible).join(',') });
    await shotRect('ours', [0, 0, global.screen_width, global.screen_height]);
}

// G4: lock and unlock cycles; our extension is enabled at each lock and disabled at each unlock
async function runChurn() {
    await sleep(3000);
    const N = Number(GLib.getenv('TAHOE_LOCK_CYCLES') ?? 50);
    const unlockTimes = [];
    for (let i = 1; i <= N; i++) {
        const dialog = await lockAndPrompt();
        const locked = frameState();
        const u = (i === 1 || i % 25 === 0 || i === N) ? await usable(dialog) : null;
        const t0 = GLib.get_monotonic_time();
        Main.screenShield.deactivate(false);
        // how long the unlock takes: until the session is back in user mode (10 s at most)
        while (Main.sessionMode.isLocked && GLib.get_monotonic_time() - t0 < 10e6)
            await sleep(25);
        const unlockMs = Math.round((GLib.get_monotonic_time() - t0) / 1000);
        unlockTimes.push(unlockMs);
        await sleep(400);
        if ((i === 1 || i % 25 === 0 || i === N) || locked.frame !== 'running' && locked.extState !== null) {
            write({ label: 'cycle', i, locked, usable: u, unlocked: frameState(), mode: Main.sessionMode.currentMode,
                actors: countActors(), rssKb: rssKb(), unlockMs,
                unlockMsMax: Math.max(...unlockTimes), unlockMsMedian: unlockTimes.slice().sort((a, b) => a - b)[unlockTimes.length >> 1] });
        }
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

// TAHOE_LOCK_MATERIAL='{"milk":0.6,...}': try a glass material without editing the extension
// (the extension's glassclock.js module is shared, so this changes what its next mask uses)
async function applyMaterial() {
    const json = GLib.getenv('TAHOE_LOCK_MATERIAL');
    const ext = lockExt();
    if (!json || !ext)
        return;
    const mod = await import(`${ext.dir.get_uri()}/glassclock.js`);
    Object.assign(mod.MATERIAL, JSON.parse(json));
    write({ label: 'material', material: mod.MATERIAL });
}

async function run() {
    await sleep(3000);
    await applyMaterial();
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
    await sleep(800);   // past the watchdog's settle delay
    write({ label: 'frame', ...frameState() });
    const ours = [];
    const walk = (a, depth) => {
        if (a.name?.startsWith('tahoe-lock') || depth > 0) {
            ours.push({ depth, type: a.constructor.name, name: a.name, style_class: a.style_class, box: box(a) ?? 'unmapped', opacity: a.opacity, effects: a.get_effects().map(e => e.constructor.name).join(',') || undefined, text: a.text ?? undefined, style: a.style ?? undefined,
                font: a instanceof St.Widget ? a.get_theme_node().get_font().to_string() : undefined });
            for (const c of a.get_children()) walk(c, depth + 1);
        } else {
            for (const c of a.get_children()) walk(c, 0);
        }
    };
    walk(global.stage, 0);
    write({ label: 'our-actors', ours });
    write({ label: 'background', effects: [...dialog._backgroundGroup].map(b => ({ x: b.x, name: b.name,
        effects: b.get_effects().map(e => `${e.constructor.name}:${e.enabled ? 'on' : 'off'}`) })) });
    const nameLabel = prompt._userWell?.get_child?.()?._label ?? null;
    write({ label: 'fonts', userName: nameLabel?.get_theme_node().get_font().to_string() ?? null,
        entry: entry.get_theme_node().get_font().to_string() });
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
        (GATE === 'churn' ? runChurn() : GATE === 'perf' ? runPerf() : GATE?.startsWith('ours-') ? runOurs(GATE.slice(5)) : FAULT ? runFault() : run()).catch(e => write({ label: 'error', error: String(e), stack: e.stack }))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
    }
    disable() {}
}
