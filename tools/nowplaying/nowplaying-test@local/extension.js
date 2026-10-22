// Headless tests of tahoe-nowplaying (docs/NOWPLAYING_PLAN.md, Phase 1 gate), run by run.sh in a
// throwaway gnome-shell. Input goes through virtual keyboard and pointer devices, so the real event
// path (the hotkey binding, the modal grab, picking) is exercised. Never locks the screen: the lock
// test fakes the shield's `locked` and emits `locked-changed` on the test shell's own shield (no
// other shell code listens to it; no PAM, no GDM).
// Results: $NP_OUT/results.jsonl (one line per test) and driver.log; the shell ends when done.

import Cairo from 'cairo';
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
const FIXTURES = GLib.getenv('NP_FIXTURES');

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
const SETTLE = 700;   // ms: longer than the view's fade in (500) and the exit (200)
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

// ---- Phase 2: the layout ----

async function shot(name, area = [0, 0, global.stage.width, global.stage.height]) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(...area.map(Math.round), stream,
        (o, res) => {
            try {
                o.screenshot_area_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

const overlaps = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

// every part on the monitor, nothing overlapping, the group centred, the clock above the column
// and its glass painted; returns the numbers for the log
function checkLayout(view, blend) {
    const problems = [];
    const g = view.geometry;
    const m = Main.layoutManager.primaryMonitor;
    const boxes = view.boxes();
    for (const [name, b] of Object.entries(boxes)) {
        if (b.x < m.x - 1 || b.y < m.y - 1 || b.x + b.width > m.x + m.width + 1 || b.y + b.height > m.y + m.height + 1)
            problems.push(`${name} off the monitor ${JSON.stringify(b)}`);
    }
    const names = ['cover', 'title', 'artist', 'progress', 'times', 'transport', 'volume', 'chevron', 'lyrics'].filter(n => boxes[n]);
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            if (overlaps(boxes[names[i]], boxes[names[j]]))
                problems.push(`${names[i]} overlaps ${names[j]}`);
        }
    }
    if (blend === 1 && !boxes.lyrics)
        problems.push('no lyrics in the two-column layout');
    if (blend === 0 && boxes.lyrics)
        problems.push('lyrics shown in the centred layout');
    // the group's middle (two columns: the column's left to the lyrics' right) on the screen's
    const left = boxes.cover.x;
    const right = blend === 1 ? boxes.lyrics.x + boxes.lyrics.width : boxes.cover.x + boxes.cover.width;
    const middle = (left + right) / 2;
    const centre = m.x + m.width / 2;
    if (Math.abs(middle - centre) > 1)
        problems.push(`group middle ${middle} vs screen centre ${centre}`);
    // the column's rows centred on the cover's axis
    const axis = boxes.cover.x + boxes.cover.width / 2;
    for (const n of ['title', 'artist', 'progress', 'times', 'transport', 'volume']) {
        const mid = boxes[n].x + boxes[n].width / 2;
        if (Math.abs(mid - axis) > 1)
            problems.push(`${n} off the cover's axis by ${(mid - axis).toFixed(1)}`);
    }
    // the chevron and the clock on the screen's centre line; the clock above the column
    const chev = boxes.chevron;
    if (Math.abs(chev.x + chev.width / 2 - centre) > 1)
        problems.push('the chevron is off centre');
    if (g.clock.bottom > boxes.cover.y - 1)
        problems.push(`the clock (bottom ${g.clock.bottom}) runs into the cover (${boxes.cover.y})`);
    if (view.clockFailed || view.clockPaints < 1)
        problems.push(`the glass clock did not paint (failed ${view.clockFailed}, paints ${view.clockPaints})`);
    log(`  layout ${m.width}x${m.height} blend ${blend}: u ${g.u.toFixed(3)} k ${g.k.toFixed(3)} middle ${middle.toFixed(1)} centre ${centre} cover ${JSON.stringify(boxes.cover)} chevron y ${chev.y}`);
    if (problems.length)
        throw new Error(problems.join('; '));
}

test('layout: both layouts', async () => {
    const ov = await openView();
    await sleep(1500);   // the clock's glyph masks are drawn after the first layout
    const tag = `${global.stage.width}x${global.stage.height}`;
    ov.view.setBlend(1);   // nothing plays here, so the view opened centred
    await sleep(300);
    await shot(`layout-lyrics-${tag}`);
    checkLayout(ov.view, 1);
    ov.view.setBlend(0);
    await sleep(300);
    await shot(`layout-nolyrics-${tag}`);
    checkLayout(ov.view, 0);
    ov.close();
    await sleep(SETTLE);
    assertClean('after the layout test');
});

// ---- Phase 3: a fake MPRIS player (made-up tracks, generated covers, the fixtures' .lrc) ----

const MPRIS_XML = `<node>
<interface name="org.mpris.MediaPlayer2"><method name="Raise"/><property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/><property name="CanRaise" type="b" access="read"/></interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Play"/><method name="Pause"/><method name="Stop"/>
  <method name="Next"/><method name="Previous"/>
  <method name="Seek"><arg type="x" direction="in"/></method>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="Shuffle" type="b" access="readwrite"/>
  <property name="LoopStatus" type="s" access="readwrite"/>
</interface></node>`;

// a square cover in two colours with a disc (made up, drawn here)
function cover(name, c0, c1) {
    const path = `${OUT}/${name}.png`;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 400, 400);
    const cr = new Cairo.Context(surface);
    const g = new Cairo.LinearGradient(0, 0, 400, 400);
    g.addColorStopRGB(0, ...c0);
    g.addColorStopRGB(1, ...c1);
    cr.setSource(g);
    cr.paint();
    cr.setSourceRGBA(1, 0.92, 0.75, 0.9);
    cr.arc(270, 130, 60, 0, 2 * Math.PI);
    cr.fill();
    surface.writeToPNG(path);
    cr.$dispose();
    return `file://${path}`;
}

function copyLrc(fixture, name) {
    const [, bytes] = GLib.file_get_contents(`${FIXTURES}/${fixture}`);
    GLib.file_set_contents(`${OUT}/${name}.lrc`, bytes);
}

class FakePlayer {
    constructor() {
        copyLrc('paper-lanterns.lrc', 'track1');
        copyLrc('plain.lrc', 'track2');
        this.tracks = [
            {id: '/fake/track/1', title: 'Paper Lanterns', artist: 'The Quiet Hours', file: 'track1', art: cover('cover1', [0.95, 0.45, 0.25], [0.45, 0.18, 0.45]), length: 214},
            {id: '/fake/track/2', title: 'Second Light', artist: 'The Quiet Hours', file: 'track2', art: cover('cover2', [0.15, 0.35, 0.75], [0.10, 0.65, 0.60]), length: 180},
            {id: '/fake/track/3', title: 'No Cover Here', artist: 'Test Artist', file: 'track3', art: null, length: 150},
        ];
        this.index = 0;
        this.status = 'Playing';
        this.position = 38;          // s, at `since`
        this.since = GLib.get_monotonic_time();
        this.shuffle = false;
        this.loop = 'None';
        this.calls = [];
        this._ids = [];
        const info = Gio.DBusNodeInfo.new_for_xml(MPRIS_XML);
        for (const iface of info.interfaces) {
            this._ids.push(Gio.DBus.session.register_object('/org/mpris/MediaPlayer2', iface,
                (c, sender, path, ifaceName, method, params, invocation) => {
                    this._method(method, params.deep_unpack());
                    invocation.return_value(null);
                },
                (c, sender, path, ifaceName, name) => this._props()[name] ?? null,
                (c, sender, path, ifaceName, name, value) => {
                    this.calls.push(`Set ${name}=${value.unpack()}`);
                    if (name === 'Shuffle')
                        this.shuffle = value.unpack();
                    if (name === 'LoopStatus')
                        this.loop = value.unpack();
                    this._changed([name]);
                    return true;
                }));
        }
        this._own = Gio.DBus.session.own_name('org.mpris.MediaPlayer2.npfake', Gio.BusNameOwnerFlags.NONE, null, null);
    }

    get track() {
        return this.tracks[this.index];
    }

    now() {
        return this.position + (this.status === 'Playing' ? (GLib.get_monotonic_time() - this.since) / 1e6 : 0);
    }

    _at(seconds) {
        this.position = Math.max(0, seconds);
        this.since = GLib.get_monotonic_time();
    }

    _props() {
        const t = this.track;
        return {
            Identity: new GLib.Variant('s', 'Fake Player'),
            DesktopEntry: new GLib.Variant('s', 'fake-player'),
            CanRaise: new GLib.Variant('b', false),
            PlaybackStatus: new GLib.Variant('s', this.status),
            Metadata: new GLib.Variant('a{sv}', {
                'mpris:trackid': new GLib.Variant('o', t.id),
                'xesam:title': new GLib.Variant('s', t.title),
                'xesam:artist': new GLib.Variant('as', [t.artist]),
                'xesam:album': new GLib.Variant('s', 'Made-Up Album'),
                'xesam:url': new GLib.Variant('s', `file://${OUT}/${t.file}.ogg`),
                ...t.art ? {'mpris:artUrl': new GLib.Variant('s', t.art)} : {},
                'mpris:length': new GLib.Variant('x', t.length * 1e6),
            }),
            Position: new GLib.Variant('x', Math.round(this.now() * 1e6)),
            CanGoNext: new GLib.Variant('b', true),
            CanGoPrevious: new GLib.Variant('b', true),
            CanSeek: new GLib.Variant('b', true),
            Shuffle: new GLib.Variant('b', this.shuffle),
            LoopStatus: new GLib.Variant('s', this.loop),
        };
    }

    _changed(names) {
        const props = this._props();
        const changed = Object.fromEntries(names.map(n => [n, props[n]]));
        Gio.DBus.session.emit_signal(null, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            new GLib.Variant('(sa{sv}as)', ['org.mpris.MediaPlayer2.Player', changed, []]));
    }

    _seeked() {
        Gio.DBus.session.emit_signal(null, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'Seeked',
            new GLib.Variant('(x)', [Math.round(this.now() * 1e6)]));
    }

    _method(method, args) {
        this.calls.push(args.length ? `${method} ${args.join(' ')}` : method);
        switch (method) {
        case 'PlayPause':
            this._at(this.now());
            this.status = this.status === 'Playing' ? 'Paused' : 'Playing';
            this._changed(['PlaybackStatus']);
            break;
        case 'Pause':
            this._at(this.now());
            this.status = 'Paused';
            this._changed(['PlaybackStatus']);
            break;
        case 'Next':
        case 'Previous':
            this.index = (this.index + (method === 'Next' ? 1 : this.tracks.length - 1)) % this.tracks.length;
            this._at(0);
            this._changed(['Metadata']);
            break;
        case 'Seek':
            this._at(this.now() + Number(args[0]) / 1e6);
            this._seeked();
            break;
        case 'SetPosition':
            this._at(Number(args[1]) / 1e6);
            this._seeked();
            break;
        }
    }

    // a track straight away (no method call): the tests' setup
    setTrack(index, position = 38) {
        this.index = index;
        this._at(position);
        this.status = 'Playing';
        this._changed(['Metadata', 'PlaybackStatus']);
    }

    destroy() {
        this._ids.forEach(id => Gio.DBus.session.unregister_object(id));
        Gio.bus_unown_name(this._own);
    }
}

let fake = null;
const view = () => ext().overlay?.view;

function expect(cond, what) {
    if (!cond)
        throw new Error(what);
}

test('player: placeholder when nothing plays', async () => {
    const ov = await openView();
    await sleep(600);
    const v = ov.view;
    expect(v._title.text === 'Not Playing', `title "${v._title.text}"`);
    expect(v.coverUri === null && v._coverGlass.visible, 'no glass card in the cover\'s place');
    expect(!v.coloursOn, 'cover colours shown with nothing playing');
    expect(v.blend === 0, `blend ${v.blend}, wanted 0 (centred)`);
    expect(!v.controls['play-pause'].reactive, 'play is live with no player');
    await shot('player-placeholder');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the placeholder');
});

test('player: playing, with lyrics', async () => {
    fake = new FakePlayer();
    await sleep(800);
    const ov = await openView();
    await sleep(2200);   // LOOKUP_DELAY, the .lrc, the cover's colours
    const v = ov.view;
    expect(v._title.text === 'Paper Lanterns' && v._artist.text === 'The Quiet Hours', `text "${v._title.text}" / "${v._artist.text}"`);
    expect(v.coverUri?.endsWith('cover1.png'), `cover ${v.coverUri}`);
    expect(v.coloursOn, 'no cover colours');
    expect(v.blend === 1, `blend ${v.blend}, wanted 1 (lyrics)`);
    expect(v._ink.some(c => c !== 255), `ink still white ${v._ink}`);
    // at about 40 s the sung line is the one from 36 s (index 1)
    const shown = v._lyrics._shown;
    expect(shown === 1 || shown === 2, `sung line ${shown} at ${fake.now().toFixed(1)} s`);
    expect(v.controls['play-pause'].child.text === String.fromCodePoint(0x100286), 'play button is not pause.fill while playing');
    await shot('player-lyrics');
    // the line moves on by itself (the next at 41 s)
    await sleep(Math.max(0, (42 - fake.now()) * 1000));
    expect(v._lyrics._shown === 2, `sung line ${v._lyrics._shown} at ${fake.now().toFixed(1)} s, wanted 2`);
    checkLayout(v, 1);
    ov.close();
    await sleep(SETTLE);
    assertClean('after playing');
});

test('player: controls and keys reach the player', async () => {
    fake.setTrack(0, 40);
    await sleep(300);
    const ov = await openView();
    await sleep(600);
    const v = ov.view;
    expect(v.blend === 1 && v.motion.value('blend') === undefined, `the layout still moves after opening on a known song (blend ${v.blend})`);
    fake.calls = [];
    const clickOn = async actor => {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        await click(x + w / 2, y + h / 2);
        await sleep(300);
    };
    await clickOn(v.controls['play-pause']);
    const [bx, by] = v.controls['play-pause'].get_transformed_position();
    expect(fake.status === 'Paused', `status ${fake.status} after play-pause (calls ${fake.calls}, button at ${bx},${by}, reactive ${v.controls['play-pause'].reactive}, blend ${v.blend}, overlay ${ext().overlay?.state})`);
    await sleep(200);
    expect(v.controls['play-pause'].child.text === String.fromCodePoint(0x100284), 'play button is not play.fill while paused');
    keys('space');
    await sleep(300);
    expect(fake.status === 'Playing', `status ${fake.status} after Space`);
    keys('Shift_L', 'Right');
    await sleep(300);
    expect(fake.calls.some(c => c === 'Seek 10000000'), `no Seek +10 s: ${fake.calls}`);
    await clickOn(v.controls.previous);   // past 3 s: restart
    expect(fake.calls.some(c => c.startsWith('SetPosition /fake/track/1 0')), `no restart: ${fake.calls}`);
    await clickOn(v.controls.shuffle);
    expect(fake.shuffle === true, `shuffle ${fake.shuffle}`);
    await clickOn(v.controls.repeat);
    expect(fake.loop === 'Playlist', `loop ${fake.loop}`);
    // a click at three quarters of the progress bar
    const [px, py] = v._progress.get_transformed_position();
    await click(px + v._progress.width * 0.75, py + v._progress.height / 2);
    await sleep(300);
    const set = fake.calls.filter(c => c.startsWith('SetPosition')).pop();
    expect(set && Math.abs(Number(set.split(' ')[2]) / 1e6 - 0.75 * 214) < 1, `no seek to 75 %: ${set}`);
    expect(ext().overlay?.state === 'open', 'a control closed the view');
    log(`  calls: ${fake.calls.join(', ')}`);
    ov.close();
    await sleep(SETTLE);
    assertClean('after the controls');
});

test('player: next track without lyrics centres, without a cover shows the glass', async () => {
    fake.setTrack(0, 40);
    await sleep(300);
    const ov = await openView();
    await sleep(2000);
    const v = ov.view;
    expect(v.blend === 1, `blend ${v.blend} before`);
    keys('Right');   // next: plain lyrics only, so none
    await sleep(400);
    expect(v.blend === 1, 'the layout jumped before the lookup');
    await sleep(1600);
    expect(v._title.text === 'Second Light', `title ${v._title.text}`);
    expect(v.blend === 0, `blend ${v.blend} with no synced lyrics`);
    expect(v.coverUri?.endsWith('cover2.png'), `cover ${v.coverUri}`);
    await shot('player-nolyrics');
    keys('Right');   // no cover
    await sleep(1800);
    expect(v._title.text === 'No Cover Here', `title ${v._title.text}`);
    expect(v.coverUri === null && v._coverGlass.visible, 'no glass card without a cover');
    expect(!v.coloursOn, 'cover colours with no cover');
    await sleep(700);
    await shot('player-nocover');
    checkLayout(v, 0);
    ov.close();
    await sleep(SETTLE);
    assertClean('after the track changes');
});

test('player: the player leaving and coming back', async () => {
    fake.setTrack(0, 40);
    await sleep(300);
    const ov = await openView();
    await sleep(800);
    fake.destroy();
    fake = null;
    await sleep(800);
    expect(view()._title.text === 'Not Playing', `title ${view()?._title.text} after the player left`);
    expect(ext().overlay?.state === 'open', 'the view closed when the player left');
    fake = new FakePlayer();
    await sleep(1200);
    expect(view()._title.text === 'Paper Lanterns', `title ${view()?._title.text} after it came back`);
    ov.close();
    await sleep(SETTLE);
    assertClean('after the player came back');
});

test('player: stay-closed setting', async () => {
    const settings = ext().getSettings();
    settings.set_string('when-nothing-plays', 'stay-closed');
    try {
        fake?.destroy();
        fake = null;
        await sleep(500);
        ext().toggle();
        await sleep(300);
        expect(!ext().overlay, 'opened with nothing playing and stay-closed');
        fake = new FakePlayer();
        await sleep(800);
        await openView();
        ext().overlay.close();
        await sleep(SETTLE);
    } finally {
        settings.set_string('when-nothing-plays', 'placeholder');
    }
    assertClean('after stay-closed');
});

// ---- Phase 4: the swirl and the transitions ----

// stage frame intervals (ms) while fn runs
async function frameTimes(fn) {
    const stamps = [];
    const id = global.stage.connect('after-paint', () => stamps.push(GLib.get_monotonic_time()));
    try {
        await fn();
    } finally {
        global.stage.disconnect(id);
    }
    const gaps = stamps.slice(1).map((t, i) => (t - stamps[i]) / 1000).sort((a, b) => a - b);
    const pct = q => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : 0;
    return {frames: stamps.length, p50: pct(0.5), p95: pct(0.95), max: gaps.at(-1) ?? 0};
}

// samples fn() every `ms` for `total` ms
async function sample(fn, total, ms = 16) {
    const out = [];
    const end = GLib.get_monotonic_time() + total * 1000;
    while (GLib.get_monotonic_time() < end) {
        out.push(fn());
        await sleep(ms);
    }
    return out;
}

// open on track `index` and wait until its lyrics, colours and layout have settled
async function openOn(index) {
    fake ??= new FakePlayer();
    fake.setTrack(index, 40);
    await sleep(400);
    const ov = await openView();
    await sleep(3400);   // the enter (the drop, its spread, the cover fading in) is slow
    return ov;
}

const near = (a, b, eps) => a.every((c, i) => c.every((v, j) => Math.abs(v - b[i][j]) < eps));

test('swirl: shows with a cover and turns slowly', async () => {
    const ov = await openOn(0);
    const sw = ov.view.swirl;
    expect(sw.amount === 1 && sw.effect.enabled, `amount ${sw.amount}, enabled ${sw.effect.enabled}`);
    const t0 = sw.t;
    await sleep(1000);
    const turned = sw.t - t0;
    expect(turned > 0.7 && turned < 1.3, `the field turned ${turned.toFixed(2)} in 1 s`);
    expect(!ov.view.motion.running, 'the frame clock still runs with nothing but the swirl');
    await shot('swirl-cover1');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the swirl');
});

test('swirl: a new cover cross-fades the colours', async () => {
    const ov = await openOn(0);
    const sw = ov.view.swirl;
    const before = sw.colours.map(c => [...c]);
    keys('Right');   // track 2, a blue cover
    await sleep(800);
    const mid = sw.colours.map(c => [...c]);
    expect(!near(mid, before, 0.01), 'the colours had not started to change');
    await sleep(1400);
    const after = sw.colours.map(c => [...c]);
    expect(!near(after, before, 0.05), 'the colours did not change');
    expect(!near(mid, after, 0.01), 'the colours jumped instead of fading');
    expect(sw.amount === 1, `amount ${sw.amount} between two covers`);
    await shot('swirl-cover2');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the cross-fade');
});

test('swirl: no cover fades to the blurred wallpaper and stops', async () => {
    const ov = await openOn(1);
    keys('Right');   // track 3, no cover
    await sleep(2000);
    const sw = ov.view.swirl;
    expect(sw.amount === 0 && !sw.effect.enabled, `amount ${sw.amount}, enabled ${sw.effect.enabled}`);
    const t0 = sw.t;
    await sleep(400);
    expect(sw.t === t0, 'the swirl still turns with no cover');
    expect(!ov.view.motion.running && !ov.view.motion._idleId, 'something still ticks with nothing to animate');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the fade to the wallpaper');
});

test('swap: lyrics to none on a spring, smooth, then still', async () => {
    const ov = await openOn(0);
    expect(ov.view.blend === 1, `blend ${ov.view.blend} with lyrics`);
    let samples;
    const timing = await frameTimes(async () => {
        keys('Right');   // track 2: no synced lyrics
        samples = await sample(() => ov.view.blend, 2600);
    });
    const jumps = samples.slice(1).map((v, i) => Math.abs(v - samples[i]));
    const biggest = Math.max(...jumps);
    expect(samples.at(-1) === 0, `blend ended at ${samples.at(-1)}`);
    expect(biggest < 0.12, `the column jumped ${biggest.toFixed(3)} in one sample`);
    expect(Math.min(...samples) > -0.1, `overshoot ${Math.min(...samples).toFixed(3)}`);
    expect(!ov.view.motion.running, 'the frame clock still runs after the swap');
    log(`  swap: ${timing.frames} frames, p50 ${timing.p50.toFixed(1)} ms, p95 ${timing.p95.toFixed(1)} ms, max ${timing.max.toFixed(1)} ms; biggest step ${biggest.toFixed(3)}`);
    append('timing.jsonl', JSON.stringify({test: 'swap', ...timing}));
    ov.close();
    await sleep(SETTLE);
    assertClean('after the swap');
});

test('swap: a change mid-way turns back smoothly', async () => {
    const ov = await openOn(1);   // centred (no synced lyrics)
    expect(ov.view.blend === 0, `blend ${ov.view.blend}`);
    // previous: track 1, whose lyrics are known by now, so the column moves at once; then next
    // again before it has arrived
    fake.setTrack(1, 1);
    await sleep(200);
    // the blend as painted: one sample per frame, at the frame's time
    const samples = [];
    const paintId = global.stage.connect('after-paint', () => samples.push([GLib.get_monotonic_time() / 1e6, ov.view.blend]));
    try {
        keys('Left');   // track 1: its lyrics are looked up (about 1 s), then the column moves
        for (let i = 0; i < 200 && ov.view.blend < 0.05; i++)
            await sleep(16);
        await sleep(150);
        keys('Right');   // track 2 (known: no lyrics) before the column has arrived
        await sleep(2400);
    } finally {
        global.stage.disconnect(paintId);
    }
    const values = samples.map(([, v]) => v);
    const peak = Math.max(...values);
    // a jump is a step between two painted frames far bigger than the spring's (paint times are
    // too irregular for a speed: two paints can come 6 ms apart)
    const steps = values.slice(1).map((v, i) => Math.abs(v - values[i]));
    const biggest = Math.max(...steps);
    expect(peak > 0.05 && peak < 0.95, `the column went to ${peak.toFixed(3)} (wanted part of the way)`);
    expect(biggest < 0.15, `a jump of ${biggest.toFixed(3)} between two frames`);
    expect(values.at(-1) === 0, `blend ended at ${values.at(-1)}`);
    log(`  turn back: peak ${peak.toFixed(3)}, biggest step per frame ${biggest.toFixed(3)} over ${values.length} frames`);
    ov.close();
    await sleep(SETTLE);
    assertClean('after the turn back');
});

// ---- Phase 5: the tilt, the widgets' glass, the lyrics' edges ----

async function pointerTo(x, y) {
    ptr.notify_absolute_motion(t(), x, y);
    await sleep(30);
}

// a point on the cover, 0..1 of its box
function onCover(v, fx, fy) {
    const [x, y] = v.parts.cover.get_transformed_position();
    const [w, h] = v.parts.cover.get_transformed_size();
    return [x + fx * w, y + fy * h];
}

test('tilt: the cover leans toward the pointer, then springs back', async () => {
    const ov = await openOn(0);
    const v = ov.view;
    await pointerTo(...onCover(v, 0.2, 0.2));
    await pointerTo(...onCover(v, 0.18, 0.22));
    await sleep(700);
    let tl = v.tilt;
    log(`  tilt at top left: ${JSON.stringify(tl)}`);
    expect(Math.abs(tl.x) > 1.2 && Math.abs(tl.y) > 1.2 && Math.abs(tl.x) <= 3.5 && Math.abs(tl.y) <= 3.5, `tilt out of range ${tl.x.toFixed(2)}, ${tl.y.toFixed(2)}`);
    expect(tl.x < 0 && tl.y > 0, `tilted the wrong way ${tl.x.toFixed(2)}, ${tl.y.toFixed(2)}`);
    expect(tl.edge > 0.9 && tl.sheen > 0.9 && tl.z > 5, `glass edge ${tl.edge}, sheen ${tl.sheen}, lift ${tl.z}`);
    await shot('tilt-a');
    // a sweep across the cover, timed
    const timing = await frameTimes(async () => {
        for (let i = 0; i <= 30; i++)
            await pointerTo(...onCover(v, 0.18 + i * 0.022, 0.22 + i * 0.019));
        await sleep(500);
    });
    tl = v.tilt;
    expect(tl.x > 0 && tl.y < 0, `after the sweep to the bottom right: ${tl.x.toFixed(2)}, ${tl.y.toFixed(2)}`);
    log(`  tilt sweep: ${timing.frames} frames, p50 ${timing.p50.toFixed(1)} ms, p95 ${timing.p95.toFixed(1)} ms, max ${timing.max.toFixed(1)} ms`);
    append('timing.jsonl', JSON.stringify({test: 'tilt', ...timing}));
    await shot('tilt-b');
    // leave: flat again, no outline, no sheen
    await pointerTo(global.stage.width - 200, global.stage.height / 2);
    await sleep(900);
    tl = v.tilt;
    expect(Math.abs(tl.x) < 0.05 && Math.abs(tl.y) < 0.05 && Math.abs(tl.z) < 0.5, `not flat after leaving: ${JSON.stringify(tl)}`);
    expect(tl.edge < 0.02 && tl.sheen < 0.02, `glass edge ${tl.edge}, sheen ${tl.sheen} after leaving`);
    expect(ext().overlay?.state === 'open', 'moving the pointer closed the view');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the tilt');
});

test('glass: the chevron and the empty cover are the widgets\' glass', async () => {
    const ov = await openOn(2);   // no cover: the card shows
    const v = ov.view;
    await sleep(500);
    const chevronGlass = v.chevron.child._glass;
    const coverGlass = v._coverGlass._glass;
    const bms = Main.extensionManager.lookup('blur-my-shell@aunetx');
    expect(bms?.state === 1, `Blur My Shell is not running in the test shell (state ${bms?.state})`);
    for (const [name, glass] of [['chevron', chevronGlass], ['cover card', coverGlass]]) {
        expect(glass?.hasGlass, `${name}: no Blur My Shell glass`);
        expect(glass._glass.pipeline.pipeline_id === 'pipeline_glassbar_dock', `${name}: pipeline ${glass._glass.pipeline.pipeline_id}`);
        expect(glass._glass.pipeline.effects.length > 0, `${name}: the pipeline has no effects`);
    }
    // the CSS stand-in's tint is gone once the real glass is there
    expect(!v.chevron.child.has_style_class_name('tahoe-np-glass'), 'the chevron still has the CSS stand-in');
    const effects = v.chevron.child._glass._glass.pipeline.effects.map(e => e._bms_effect_type ?? e.constructor.name);
    log(`  chevron glass effects: ${effects.join(', ')}`);
    await shot('glass-nocover');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the glass');
});

test('lyrics: the top and bottom fade out blurred', async () => {
    const ov = await openOn(0);
    const fade = ov.view.parts.lyrics.get_effect('edge-fade');
    expect(fade, 'no edge fade on the lyrics');
    await shot('lyrics-edges');
    ov.close();
    await sleep(SETTLE);
    assertClean('after the lyrics edges');
});

// ---- Phase 6: the enter ----

test('enter: the cover pours out of a circle of glass, then the art fades in', async () => {
    fake ??= new FakePlayer();
    fake.setTrack(0, 40);
    await sleep(600);
    ext().toggle();
    const samples = [];
    const paintId = global.stage.connect('after-paint', () => {
        const p = ext().overlay?.view?.pour;
        if (p)
            samples.push(p);
    });
    try {
        await sleep(3800);
    } finally {
        global.stage.disconnect(paintId);
    }
    const v = ext().overlay?.view;
    expect(samples.length > 10, `only ${samples.length} frames of the pour`);
    const first = samples.find(p => p.opacity > 0) ?? samples[0];
    const cover = v.parts.cover.width;
    expect(first.width < cover * 0.3 && Math.abs(first.radius - first.width / 2) < 2, `it did not start as a small circle: ${JSON.stringify(first)}`);
    const widest = samples.reduce((m, p) => Math.max(m, p.width), 0);
    expect(widest >= cover - 2, `it never opened to the cover's size (${widest} of ${cover})`);
    // never past the cover: no rim of glass around the art as it fades in
    expect(widest <= cover + 0.5, `the glass grew past the cover (${widest.toFixed(1)} of ${cover})`);
    const open = samples.filter(p => p.width >= cover - 2);
    expect(open.some(p => Math.abs(p.radius - v._coverRadius) < 1.5), `the corners never became the cover's: ${open.map(p => p.radius.toFixed(1)).slice(0, 5)}`);
    expect(samples.some(p => p.art > 200 && p.opacity > 200), 'the art did not come in over the glass');
    // one piece: the cover fades in only once the glass is full size
    const early = samples.find(p => p.art > 0 && p.width < cover - 1);
    expect(!early, `the cover started to fade in before the glass was full size: ${JSON.stringify(early)}`);
    expect(!v.pour && v._coverBox.opacity === 255, `after the enter: pour ${JSON.stringify(v.pour)}, art ${v._coverBox.opacity}`);
    log(`  pour: ${samples.length} frames, from ${first.width.toFixed(0)} px round to ${widest.toFixed(0)} px (cover ${cover})`);
    ext().overlay.close();
    await sleep(SETTLE);
    assertClean('after the enter');
});

test('enter: no tilt while the cover pours in, then the tilt', async () => {
    fake ??= new FakePlayer();
    fake.setTrack(0, 40);
    await sleep(600);
    ext().toggle();
    await sleep(60);
    const v = ext().overlay.view;
    // the pointer over the cover's top left while it pours in
    const [x, y] = v.parts.cover.get_transformed_position();
    const [w, h] = v.parts.cover.get_transformed_size();
    await pointerTo(x + 0.2 * w, y + 0.2 * h);
    await pointerTo(x + 0.22 * w, y + 0.21 * h);
    await sleep(200);
    expect(v.entering, 'the enter was already over (test timing)');
    const during = v.tilt;
    expect(Math.abs(during.x) < 0.01 && Math.abs(during.y) < 0.01 && during.edge < 0.01, `tilted during the enter: ${JSON.stringify(during)}`);
    await sleep(3600);
    expect(!v.entering, 'the enter did not finish');
    const after = v.tilt;
    expect(Math.abs(after.x) > 1 && Math.abs(after.y) > 1 && after.edge > 0.9, `no tilt after the enter: ${JSON.stringify(after)}`);
    await pointerTo(global.stage.width - 200, global.stage.height / 2);
    ext().overlay.close();
    await sleep(SETTLE);
    assertClean('after the tilt during the enter');
});

// NP_RECORD=1: the enter, a shot every frame it allows
test('record: enter', async () => {
    if (!GLib.getenv('NP_RECORD'))
        return;
    fake ??= new FakePlayer();
    fake.setTrack(0, 40);
    await sleep(600);
    ext().toggle();
    // the cover's area only (a small shot is fast enough to catch the pour)
    const area = [300, 200, 760, 760];
    const start = GLib.get_monotonic_time();
    for (let i = 0; i < 120 && GLib.get_monotonic_time() - start < 3400000; i++) {
        await shot(`enter-${String(i).padStart(2, '0')}`, area);
        const v = ext().overlay?.view;
        const d = v?._drop;
        const box = d ? [...d.get_transformed_position(), ...d.get_transformed_size()].map(n => Math.round(n)) : null;
        const clip = d?._glass?._copy?.has_clip ? d._glass._copy.get_clip().map(n => Math.round(n)) : null;
        const ov = ext().overlay;
        ov._id ??= Math.random().toString(36).slice(2, 6);
        append('enter-times.txt', `${i} ${((GLib.get_monotonic_time() - start) / 1000).toFixed(0)} ov ${ov?._id} ${ov?.state} entering ${v?.entering} stack ${v?._coverBox.opacity} pour ${JSON.stringify(v?.pour)} col ${v?._column.opacity} art ${v?._coverArt ? 1 : 0}`);
    }
    ext().overlay.close();
    await sleep(SETTLE);
});

// NP_RECORD=1: shots every 100 ms through a track change and the swap (docs recordings)
test('record: track change and swap', async () => {
    if (!GLib.getenv('NP_RECORD'))
        return;
    const ov = await openOn(0);
    keys('Right');
    for (let i = 0; i < 24; i++) {
        await shot(`rec-${String(i).padStart(2, '0')}`);
        await sleep(60);
    }
    ov.close();
    await sleep(SETTLE);
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
    fake?.destroy();
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
