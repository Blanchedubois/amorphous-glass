// Headless tests of tahoe-nowplaying (docs/NOWPLAYING_PLAN.md, Phase 1 gate), run by run.sh in a
// throwaway gnome-shell. Input goes through virtual keyboard and pointer devices, so the real event
// path (the hotkey binding, the modal grab, picking) is exercised. Never locks the screen: the lock
// test fakes the shield's `locked` and emits `locked-changed` on the test shell's own shield (no
// other shell code listens to it; no PAM, no GDM).
// Results: $NP_OUT/results.jsonl (one line per test) and driver.log; the shell ends when done.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('NP_OUT');
const UUID = 'tahoe-nowplaying@cachyos-tahoe';
const ONLY = GLib.getenv('NP_ONLY');   // a test name prefix, to run some only

function append(file, text) {
    const st = Gio.File.new_for_path(`${OUT}/${file}`).append_to(Gio.FileCreateFlags.NONE, null);
    st.write_all(new TextEncoder().encode(`${text}\n`), null);
    st.close(null);
}
const log = msg => append('driver.log', msg);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

const ext = () => Main.extensionManager.lookup(UUID)?.stateObj;
const overlayActors = () => Main.layoutManager.uiGroup.get_children().filter(a => a.name === 'tahoe-nowplaying').length;

// ---- virtual input ----
let kbd, ptr;
const t = () => GLib.get_monotonic_time();
function keys(...names) {   // pressed in order, released in reverse
    const vals = names.map(n => Clutter[`KEY_${n}`]);
    for (const v of vals)
        kbd.notify_keyval(t(), v, Clutter.KeyState.PRESSED);
    for (const v of [...vals].reverse())
        kbd.notify_keyval(t(), v, Clutter.KeyState.RELEASED);
}
async function click(x, y) {
    ptr.notify_absolute_motion(t(), x, y);
    await sleep(60);
    ptr.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await sleep(40);
    ptr.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
}

// ---- the tests ----
const SETTLE = 450;   // ms: longer than the enter (250) and the exit (200)
let actions = [];

async function openView() {
    ext().toggle();
    await sleep(SETTLE);
    const ov = ext().overlay;
    if (!ov || ov.state !== 'open')
        throw new Error(`did not open (state ${ov?.state})`);
    return ov;
}

// the view is gone and nothing is left behind
function assertClean(where) {
    const problems = [];
    if (ext().overlay)
        problems.push(`overlay still ${ext().overlay.state}`);
    if (overlayActors())
        problems.push(`${overlayActors()} overlay actors left`);
    if (Main.modalCount !== 0)
        problems.push(`modalCount ${Main.modalCount}`);
    if (Main.actionMode !== Shell.ActionMode.NORMAL)
        problems.push(`actionMode ${Main.actionMode}`);
    if (problems.length)
        throw new Error(`${where}: ${problems.join(', ')}`);
}

function assertOpen(where) {
    const ov = ext().overlay;
    if (!ov || ov.state !== 'open' || Main.modalCount !== 1 || overlayActors() !== 1)
        throw new Error(`${where}: expected open, got ${ov?.state ?? 'none'}, modalCount ${Main.modalCount}, actors ${overlayActors()}`);
}

// [name, keys held, expected: 'close' | action name (stays open)]
const KEY_ROWS = [
    ['Escape', ['Escape'], 'close'],
    ['hotkey', ['Super_L', 'Shift_L', 'm'], 'close'],
    ['Space', ['space'], 'play-pause'],
    ['Right', ['Right'], 'next'],
    ['Left', ['Left'], 'previous'],
    ['Shift+Right', ['Shift_L', 'Right'], 'seek-forward'],
    ['Shift+Left', ['Shift_L', 'Left'], 'seek-back'],
    ['Up', ['Up'], 'volume-up'],
    ['Down', ['Down'], 'volume-down'],
    ['Shift alone', ['Shift_L'], 'none'],
    ['Ctrl alone', ['Control_L'], 'none'],
    ['Alt alone', ['Alt_L'], 'none'],
    ['Super alone', ['Super_L'], 'none'],
    ['AudioPlay', ['AudioPlay'], 'play-pause'],
    ['AudioNext', ['AudioNext'], 'next'],
    ['AudioPrev', ['AudioPrev'], 'previous'],
    ['AudioRaiseVolume', ['AudioRaiseVolume'], 'pass'],
    ['AudioMute', ['AudioMute'], 'pass'],
    ['a', ['a'], 'close'],
    ['Return', ['Return'], 'close'],
    ['Tab', ['Tab'], 'close'],
    ['F5', ['F5'], 'close'],
    ['Ctrl+Right', ['Control_L', 'Right'], 'close'],
    ['Ctrl+Space', ['Control_L', 'space'], 'close'],
];

const TESTS = [];
const test = (name, fn) => TESTS.push([name, fn]);

test('hotkey opens and closes', async () => {
    keys('Super_L', 'Shift_L', 'm');
    await sleep(SETTLE);
    assertOpen('after the hotkey');
    keys('Super_L', 'Shift_L', 'm');
    await sleep(SETTLE);
    assertClean('after the hotkey again');
});

for (const [name, held, want] of KEY_ROWS) {
    test(`key ${name}`, async () => {
        await openView();
        actions = [];
        keys(...held);
        await sleep(SETTLE);
        if (want === 'close') {
            assertClean(`after ${name}`);
            return;
        }
        assertOpen(`after ${name}`);
        const got = ext().overlay.lastKeyAction;
        if (got !== want)
            throw new Error(`${name}: action ${got}, wanted ${want}`);
        const sent = ['none', 'pass'].includes(want) ? [] : [want];
        if (JSON.stringify(actions) !== JSON.stringify(sent))
            throw new Error(`${name}: actions sent ${JSON.stringify(actions)}, wanted ${JSON.stringify(sent)}`);
        ext().overlay.close();
        await sleep(SETTLE);
        assertClean(`closing after ${name}`);
    });
}

test('Print stays open (decide)', async () => {
    const {decide} = await import(`file://${Main.extensionManager.lookup(UUID).path}/keys.js`);
    const got = decide(Clutter.KEY_Print, 0, []);
    if (got !== 'pass')
        throw new Error(`Print: ${got}`);
});

test('Escape mid-enter', async () => {
    ext().toggle();
    await sleep(60);
    if (ext().overlay?.state !== 'opening')
        throw new Error(`not opening: ${ext().overlay?.state}`);
    keys('Escape');
    await sleep(SETTLE);
    assertClean('after Escape mid-enter');
});

test('click outside closes', async () => {
    await openView();
    await click(400, 400);
    await sleep(SETTLE);
    assertClean('after a click outside');
});

test('click on a control stays open', async () => {
    const ov = await openView();
    const button = new St.Button({reactive: true, width: 120, height: 80, style: 'background-color: red;'});
    button._tahoeNpControl = true;
    let clicked = 0;
    button.connect('clicked', () => clicked++);
    button.set_position(1000, 600);
    ov.actor.add_child(button);
    await sleep(100);
    await click(1060, 640);
    await sleep(SETTLE);
    assertOpen('after a click on a control');
    if (clicked !== 1)
        throw new Error(`the control got ${clicked} clicks`);
    ov.close();
    await sleep(SETTLE);
    assertClean('closing after the control');
});

test('chevron closes', async () => {
    const ov = await openView();
    const [x, y] = ov.chevron.get_transformed_position();
    const [w, h] = ov.chevron.get_transformed_size();
    await click(x + w / 2, y + h / 2);
    await sleep(SETTLE);
    assertClean('after the chevron');
});

test('input reaches the desktop during the exit', async () => {
    const ov = await openView();
    ov.close();
    // the grab is gone at the exit's first frame
    if (Main.modalCount !== 0)
        throw new Error(`modalCount ${Main.modalCount} right after close()`);
    if (ov.actor?.reactive)
        throw new Error('the overlay still takes input during the exit');
    await sleep(SETTLE);
    assertClean('after the exit');
});

test('exception in a handler tears down', async () => {
    const ov = await openView();
    ov._onKey = () => {
        throw new Error('injected test failure (expected in the log)');
    };
    keys('space');
    await sleep(100);
    assertClean('after the injected exception');
});

test('watchdog ends a stuck enter', async () => {
    ext().toggle();
    const ov = ext().overlay;
    // a stuck enter: its transition removed before it could finish
    ov.actor.remove_all_transitions();
    await sleep(3300);
    assertOpen('after the watchdog');
    if (ov.actor.opacity !== 255)
        throw new Error(`opacity ${ov.actor.opacity}`);
    ov.close();
    await sleep(SETTLE);
    assertClean('closing after the watchdog');
});

test('watchdog ends a stuck exit', async () => {
    const ov = await openView();
    ov.close();
    ov.actor.remove_all_transitions();
    await sleep(3300);
    assertClean('after the exit watchdog');
});

test('disable while open', async () => {
    await openView();
    Main.extensionManager.disableExtension(UUID);
    await sleep(200);
    if (Main.modalCount !== 0 || overlayActors())
        throw new Error(`after disable: modalCount ${Main.modalCount}, actors ${overlayActors()}`);
    Main.extensionManager.enableExtension(UUID);
    await sleep(300);
    ext().onAction = a => actions.push(a);
    assertClean('after enable again');
});

test('lock closes', async () => {
    await openView();
    const shield = Main.screenShield;
    Object.defineProperty(shield, 'locked', {get: () => true, configurable: true});
    try {
        shield.emit('locked-changed');
    } finally {
        delete shield.locked;
    }
    await sleep(100);
    assertClean('after locked-changed');
});

test('monitors-changed closes', async () => {
    await openView();
    Main.layoutManager.emit('monitors-changed');
    await sleep(100);
    assertClean('after monitors-changed');
});

test('refused grab does not open', async () => {
    const {modal} = await import(`file://${Main.extensionManager.lookup(UUID).path}/overlay.js`);
    const push = modal.push;
    // a grab revoked from the start (another grab took the input)
    modal.push = actor => {
        const grab = push(actor);
        return {is_revoked: () => true, dismiss: () => grab.dismiss(), real: grab};
    };
    const pop = modal.pop;
    modal.pop = g => pop(g.real ?? g);
    try {
        ext().toggle();
        await sleep(100);
    } finally {
        modal.push = push;
        modal.pop = pop;
    }
    assertClean('after a refused grab');
});

test('hotkey spam', async () => {
    for (let i = 0; i < 40; i++) {
        ext().toggle();
        await sleep(15 + (i * 37) % 260);
    }
    if (ext().overlay?.state && ext().overlay.state !== 'closing')
        ext().overlay.close();
    await sleep(SETTLE + 100);
    assertClean('after 40 toggles');
});

async function run() {
    await sleep(Number(GLib.getenv('NP_WAIT') ?? 3000));
    Main.overview.hide();
    await sleep(800);
    const seat = global.stage.context.get_backend().get_default_seat();
    kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    if (!ext())
        throw new Error('tahoe-nowplaying is not enabled');
    ext().onAction = a => actions.push(a);
    let failed = 0;
    for (const [name, fn] of TESTS) {
        if (ONLY && !name.startsWith(ONLY))
            continue;
        let result = {name, ok: true};
        try {
            await fn();
        } catch (e) {
            failed++;
            result = {name, ok: false, error: String(e?.message ?? e)};
            // leave a clean shell for the next test
            ext()?.overlay?.teardown();
            await sleep(200);
        }
        append('results.jsonl', JSON.stringify(result));
        log(`${result.ok ? 'PASS' : 'FAIL'} ${name}${result.ok ? '' : `: ${result.error}`}`);
    }
    log(`done, ${failed} failed`);
}

export default class NowPlayingTest extends Extension {
    enable() {
        log('enable');
        run().catch(e => log(`error: ${e}\n${e.stack}`))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                global.context.terminate();
                return GLib.SOURCE_REMOVE;
            }));
    }

    disable() {}
}
