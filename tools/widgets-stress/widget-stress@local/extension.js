// Headless only (never installed): stress test for tahoe-widgets. Counts the extension's live
// GLib timers, its D-Bus signal subscriptions, stage actors and the shell's D-Bus match rules;
// runs spam clicks, rapid track and player changes, fast drags, scrolls, menu spam,
// lock/unlock and disable/enable cycles and a fullscreen cover; writes $SHOT_OUT/stress.jsonl.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

const OUT = GLib.getenv('SHOT_OUT');
const UUID = 'tahoe-widgets@cachyos-tahoe';
const HARNESS = GLib.getenv('STRESS_HARNESS');
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

function write(obj) {
    const f = Gio.File.new_for_path(`${OUT}/stress.jsonl`);
    const st = f.append_to(Gio.FileCreateFlags.NONE, null);
    st.write_all(new TextEncoder().encode(`${JSON.stringify({t: GLib.DateTime.new_now_local().format('%H:%M:%S.%f').slice(0, 12), ...obj})}\n`), null);
    st.close(null);
}

// ---- instrumentation: what the widgets extension holds ----
const fromWidgets = () => new Error().stack.includes(UUID);
const live = {timers: new Map(), subs: new Set()};
const created = {timers: 0, ticks: 0};
function patchTimers() {
    for (const name of ['timeout_add', 'timeout_add_seconds', 'idle_add']) {
        const orig = GLib[name];
        GLib[name] = (...args) => {
            if (!fromWidgets())
                return orig(...args);
            const stack = new Error().stack;
            const fi = args.findIndex(a => typeof a === 'function');
            const fn = args[fi];
            let id = 0;
            args[fi] = (...cb) => {
                const r = fn(...cb);
                if (r === GLib.SOURCE_REMOVE || r === false || r === undefined)
                    live.timers.delete(id);
                return r;
            };
            id = orig(...args);
            created.timers++;
            if (stack.includes('_tick@'))
                created.ticks++;
            live.timers.set(id, stack.split('\n').find(l => l.includes(UUID))?.replace(/.*\//, '') ?? '?');
            return id;
        };
    }
    const remove = GLib.source_remove;
    GLib.source_remove = id => {
        live.timers.delete(id);
        return remove(id);
    };
    const proto = Gio.DBusConnection.prototype;
    const sub = proto.signal_subscribe, unsub = proto.signal_unsubscribe;
    proto.signal_subscribe = function (...a) {
        const id = sub.apply(this, a);
        if (fromWidgets())
            live.subs.add(id);
        return id;
    };
    proto.signal_unsubscribe = function (id) {
        live.subs.delete(id);
        return unsub.call(this, id);
    };
}

function countActors(a = global.stage) {
    let n = 1;
    for (const c of a.get_children())
        n += countActors(c);
    return n;
}

async function matchRules() {
    try {
        const name = Gio.DBus.session.get_unique_name();
        const r = await new Promise((res, rej) => Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus.Debug.Stats', 'GetConnectionStats', new GLib.Variant('(s)', [name]), null,
            Gio.DBusCallFlags.NONE, 2000, null, (b, x) => { try { res(b.call_finish(x)); } catch (e) { rej(e); } }));
        return r.deep_unpack()[0].MatchRules?.unpack() ?? null;
    } catch {
        return null;
    }
}

async function counts(label) {
    await sleep(600);
    const c = {label, timers: live.timers.size, timerSites: [...new Set(live.timers.values())], dbusSubs: live.subs.size,
        actors: countActors(), widgets: widgets().length, matchRules: await matchRules()};
    write({counts: c});
    return c;
}

// ---- the widgets on screen ----
function widgets() {
    return Main.layoutManager._backgroundGroup.get_children().filter(a => a.has_style_class_name?.('tahoe-widget'));
}
function find(actor, test, out = []) {
    if (test(actor))
        out.push(actor);
    for (const c of actor.get_children())
        find(c, test, out);
    return out;
}
const musicWidgets = () => widgets().filter(w => [...(w.get_style_class_name() ?? '').split(' ')].some(c => c.startsWith('tahoe-widget-music')));
const buttons = (w, icon) => find(w, a => a instanceof St.Button && a.child?.icon_name?.startsWith(icon));
const titles = () => musicWidgets().map(w => find(w, a => a.has_style_class_name?.('tahoe-music-title'))[0]?.text);
const playIcons = () => musicWidgets().map(w => find(w, a => a instanceof St.Button && /media-playback/.test(a.child?.icon_name ?? ''))[0]?.child.icon_name);

// ---- fake MPRIS players with a slow reply, counting what they are asked ----
const XML = `<node>
<interface name="org.mpris.MediaPlayer2"><property name="Identity" type="s" access="read"/></interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
</interface></node>`;
const INFO = Gio.DBusNodeInfo.new_for_xml(XML);

class FakePlayer {
    constructor(id, {playing = true, delay = 40} = {}) {
        this.id = id;
        this.status = playing ? 'Playing' : 'Paused';
        this.track = 1;
        this.delay = delay;
        this.calls = {PlayPause: 0, Next: 0, Previous: 0, Get: 0};
        this.conn = Gio.DBusConnection.new_for_address_sync(Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, null),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
        this.regs = INFO.interfaces.map(iface => this.conn.register_object('/org/mpris/MediaPlayer2', iface,
            (c, sender, path, ifaceName, method, params, inv) => {
                this.calls[method] = (this.calls[method] ?? 0) + 1;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.delay, () => {
                    if (method === 'PlayPause')
                        this.status = this.status === 'Playing' ? 'Paused' : 'Playing';
                    if (method === 'Next')
                        this.track++;
                    if (method === 'Previous')
                        this.track = Math.max(1, this.track - 1);
                    this.changed(method === 'PlayPause' ? ['PlaybackStatus'] : ['Metadata']);
                    inv.return_value(null);
                    return GLib.SOURCE_REMOVE;
                });
            },
            (c, sender, path, ifaceName, name) => {
                if (name === 'Position')
                    this.calls.Get++;
                return this.prop(name);
            }, null));
        this.nameId = 0;
    }

    title() {
        return `Track ${this.track} of ${this.id}`;
    }

    prop(name) {
        switch (name) {
        case 'Identity': return new GLib.Variant('s', this.id);
        case 'PlaybackStatus': return new GLib.Variant('s', this.status);
        case 'Position': return new GLib.Variant('x', 30 * 1e6);
        case 'CanGoNext': case 'CanGoPrevious': return new GLib.Variant('b', true);
        case 'Metadata': return new GLib.Variant('a{sv}', {
            'mpris:trackid': new GLib.Variant('o', `/fake/${this.id}/${this.track}`),
            'xesam:title': new GLib.Variant('s', this.title()),
            'xesam:artist': new GLib.Variant('as', []),   // no artist: lyrics never go to lrclib.net
            'xesam:url': new GLib.Variant('s', `file://${OUT}/${this.id}-${this.track}.ogg`),
            'mpris:length': new GLib.Variant('x', 200 * 1e6),
        });
        }
        return null;
    }

    changed(names) {
        const changed = {};
        names.forEach(n => (changed[n] = this.prop(n)));
        this.conn.emit_signal(null, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            new GLib.Variant('(sa{sv}as)', ['org.mpris.MediaPlayer2.Player', changed, []]));
    }

    own() {
        this.nameId = Gio.bus_own_name_on_connection(this.conn, `org.mpris.MediaPlayer2.${this.id}`, Gio.BusNameOwnerFlags.NONE, null, null);
    }

    unown() {
        if (this.nameId)
            Gio.bus_unown_name(this.nameId);
        this.nameId = 0;
    }
}

// ---- virtual pointer ----
let pointer = null;
function vp() {
    pointer ??= global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    return pointer;
}
const now = () => GLib.get_monotonic_time();
function move(x, y) {
    vp().notify_absolute_motion(now(), x, y);
}
function button(b, pressed) {
    vp().notify_button(now(), b, pressed ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED);
}

// ---- scenarios ----
async function spamClicks(players) {
    const [p] = players;
    const before = {...p.calls};
    for (const icon of ['media-playback', 'media-skip-forward', 'media-skip-backward']) {
        for (let i = 0; i < 25; i++) {
            for (const w of musicWidgets())
                buttons(w, icon).forEach(b => b.emit('clicked', 1));
            await sleep(i % 5 === 0 ? 0 : 8);
        }
    }
    await sleep(1500);
    const asked = Object.fromEntries(Object.entries(p.calls).map(([k, v]) => [k, v - before[k]]));
    const expectIcon = p.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    const icons = playIcons();
    write({scenario: 'spam clicks (75 x 4 widgets, 0-8 ms apart, player answers in 40 ms)', asked,
        playerStatus: p.status, playerTitle: p.title(), icons, titles: titles(),
        ok: icons.every(i => i === expectIcon) && titles().every(t => t === p.title())});
}

async function rapidTracks(players) {
    const [p] = players;
    for (let i = 0; i < 40; i++) {
        p.track++;
        p.changed(['Metadata']);
        if (i % 3 === 0)
            await sleep(5);
    }
    await sleep(1500);
    write({scenario: 'rapid track changes (40, ~5 ms apart)', playerTitle: p.title(), titles: titles(),
        gets: p.calls.Get, ok: titles().every(t => t === p.title())});
}

async function playersFlicker(players) {
    const [p1] = players;
    const p2 = new FakePlayer('flicker', {playing: true});
    if (p1.status === 'Playing') {
        p1.status = 'Paused';
        p1.changed(['PlaybackStatus']);
    }
    for (let i = 0; i < 30; i++) {
        p2.own();
        await sleep(i % 4 * 6);
        p2.unown();
        await sleep(i % 3 * 4);
    }
    await sleep(1500);
    const gone = titles().every(t => t === p1.title());
    p2.own();
    await sleep(1000);
    const shown = titles().every(t => t === p2.title());
    p2.unown();
    await sleep(1000);
    write({scenario: 'player appears/disappears 30 times (0-18 ms)', afterFlicker: titles(), backToFirst: gone,
        secondShownWhenStays: shown, final: titles(), ok: gone && shown && titles().every(t => t === p1.title())});
}

async function fastDrags() {
    const ws = widgets();
    const errorsBefore = errors();
    for (let i = 0; i < 20; i++) {
        const w = ws[i % ws.length];
        const [x, y] = w.get_transformed_position();
        move(x + 20, y + 20);
        await sleep(4);
        button(Clutter.BUTTON_PRIMARY, true);
        for (let k = 1; k <= 6; k++) {
            move(x + 20 + k * 37 * (i % 2 ? 1 : -0.3), y + 20 + k * 11);
            await sleep(3);
        }
        button(Clutter.BUTTON_PRIMARY, false);
        await sleep(i % 2 ? 0 : 30);   // the next drag starts while this one still snaps
    }
    await sleep(800);
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const offGridList = widgets().filter(w => Math.round(w.x / scale) % 8 || Math.round(w.y / scale) % 8);
    const offGrid = offGridList.length;
    write({offGridAt: offGridList.map(w => [w.x, w.y, w.width, w.height]), workArea: (a => [a.x, a.y, a.width, a.height])(Main.layoutManager.getWorkAreaForMonitor(0))});
    const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    const outside = widgets().filter(w => w.x < area.x || w.y < area.y ||
        w.x + w.width > area.x + area.width || w.y + w.height > area.y + area.height).length;
    let saved = null;
    try {
        saved = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(
            GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass', 'widgets.json']))[1])).widgets.length;
    } catch {}
    write({scenario: 'fast drags (20, next one during the snap)', offGrid, outside, savedWidgets: saved,
        widgets: widgets().length, newErrors: errors() - errorsBefore,
        ok: offGrid === 0 && outside === 0 && saved === widgets().length && errors() === errorsBefore});
}

async function scrolls() {
    const before = widgets().map(w => [w.x, w.y]);
    const errorsBefore = errors();
    for (const w of widgets()) {
        const [x, y] = w.get_transformed_position();
        move(x + w.width / 2, y + w.height / 2);
        for (let i = 0; i < 60; i++) {
            vp().notify_discrete_scroll(now(), i % 2 ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN,
                Clutter.ScrollSource.WHEEL);
            vp().notify_scroll_continuous(now(), 0, i % 2 ? 40 : -40, Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
        }
        await sleep(10);
    }
    await sleep(500);
    const moved = widgets().filter((w, i) => w.x !== before[i][0] || w.y !== before[i][1]).length;
    write({scenario: 'fast scrolling over every widget (120 events each)', moved, newErrors: errors() - errorsBefore,
        ok: moved === 0 && errors() === errorsBefore});
}

async function menuSpam() {
    const errorsBefore = errors();
    const w = widgets()[0];
    const [x, y] = w.get_transformed_position();
    for (let i = 0; i < 20; i++) {
        move(x + 30 + i, y + 30);
        button(Clutter.BUTTON_SECONDARY, true);
        button(Clutter.BUTTON_SECONDARY, false);
        await sleep(i % 2 ? 0 : 15);
    }
    await sleep(400);
    global.stage.get_key_focus();
    Main.layoutManager.uiGroup.get_children().forEach(a => a._delegate?.close?.());
    vp().notify_key?.(now(), 1, Clutter.KeyState.PRESSED);   // Escape
    vp().notify_key?.(now(), 1, Clutter.KeyState.RELEASED);
    await sleep(400);
    write({scenario: 'right-click menu spam (20)', newErrors: errors() - errorsBefore, ok: errors() === errorsBefore});
}

async function lockCycles(n) {
    for (let i = 0; i < n; i++) {
        Main.sessionMode.pushMode('unlock-dialog');
        await sleep(i % 2 ? 50 : 400);
        Main.sessionMode.popMode('unlock-dialog');
        await sleep(i % 2 ? 50 : 400);
    }
    await sleep(1500);
}

async function offOnCycles(n) {
    for (let i = 0; i < n; i++) {
        Main.extensionManager.disableExtension(UUID);
        await sleep(i % 2 ? 0 : 200);
        Main.extensionManager.enableExtension(UUID);
        await sleep(i % 2 ? 30 : 300);
    }
    await sleep(1500);
}

async function idle(label, ms) {
    const t0 = created.ticks;
    await sleep(ms);
    const ticks = created.ticks - t0;
    write({idle: label, seconds: ms / 1000, ticks});
    return ticks;
}

async function fullscreenCover() {
    if (!HARNESS)
        return write({scenario: 'fullscreen cover', skipped: 'no harness dir'});
    const proc = Gio.Subprocess.new(['gjs', `${HARNESS}/fullscreen.js`, '9000'], Gio.SubprocessFlags.NONE);
    let covered = false;
    for (let i = 0; i < 40 && !covered; i++) {
        await sleep(100);
        covered = Main.layoutManager.monitors[Main.layoutManager.primaryIndex].inFullscreen;
    }
    const ticks = covered ? await idle('covered by a fullscreen window', 5000) : null;
    proc.force_exit();
    await sleep(800);
    const after = await idle('after the fullscreen window closed', 3000);
    write({scenario: 'fullscreen cover pauses the tick', covered, ticksWhileCovered: ticks, ticksAfter: after,
        ok: covered && ticks === 0 && after >= 2});
}

// errors and criticals the shell has logged so far (its stderr is $SHOT_OUT/shell.log)
function errors() {
    try {
        const text = new TextDecoder().decode(GLib.file_get_contents(`${OUT}/shell.log`)[1]);
        return text.split('\n').filter(l => /JS ERROR|CRITICAL|JS WARNING|tahoe-widgets:/.test(l) &&
            !/disable-extensions|downloading update/.test(l)).length;
    } catch {
        return -1;
    }
}

let started = false;

export default class Stress extends Extension {
    enable() {
        if (started)   // stays on across session modes; run once
            return;
        started = true;
        this._run().catch(e => write({error: `${e}`, stack: e.stack}))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
    }

    async _run() {
        await sleep(4000);
        Main.overview.hide();
        patchTimers();
        // who destroys calendar event sources (and when)
        const destroy = Calendar.DBusEventSource.prototype.destroy;
        Calendar.DBusEventSource.prototype.destroy = function () {
            write({eventSourceDestroyedBy: new Error().stack.split('\n').slice(1, 4).map(l => l.replace(/.*\//, ''))});
            return destroy.call(this);
        };
        // reload the widgets so everything they make is counted
        Main.extensionManager.disableExtension(UUID);
        await sleep(300);
        const players = [new FakePlayer('stressA')];
        players[0].own();
        Main.extensionManager.enableExtension(UUID);
        await sleep(3000);
        const start = await counts('start');
        write({info: {widgets: widgets().length, music: musicWidgets().length, titles: titles()}});

        if (GLib.getenv('STRESS_ONLY') === 'control') {
            // the same track changes, player flicker and lock cycles with the widgets off
            Main.extensionManager.disableExtension(UUID);
            await sleep(500);
            write({control: 'widgets off', errorsBefore: errors()});
            await rapidTracks(players);
            write({control: 'after rapid tracks', errors: errors()});
            await playersFlicker(players);
            write({control: 'after flicker', errors: errors()});
            await lockCycles(8);
            write({control: 'after lock cycles', errors: errors()});
            return;
        }
        if (GLib.getenv('STRESS_ONLY') === 'idle') {
            await idle('only minute widgets (digital, glass text, calendar, weather), 65 s', 65000);
            players[0].status = 'Paused';
            players[0].changed(['PlaybackStatus']);
            return;
        }
        if (GLib.getenv('STRESS_ONLY') === 'drags') {
            await fastDrags();
            write({errors: errors()});
            return;
        }
        await idle('all widgets, music playing', 5000);
        await spamClicks(players);
        await rapidTracks(players);
        await playersFlicker(players);
        await fastDrags();
        await scrolls();
        await menuSpam();
        await fullscreenCover();
        const mid = await counts('after interaction');

        await lockCycles(8);
        const afterLock = await counts('after 8 lock/unlock cycles');
        await offOnCycles(10);
        const afterOff = await counts('after 10 disable/enable cycles');
        await lockCycles(8);
        const end = await counts('after 8 more lock/unlock cycles');
        write({leaks: {
            timers: [start.timers, mid.timers, afterLock.timers, afterOff.timers, end.timers],
            dbusSubs: [start.dbusSubs, mid.dbusSubs, afterLock.dbusSubs, afterOff.dbusSubs, end.dbusSubs],
            actors: [start.actors, mid.actors, afterLock.actors, afterOff.actors, end.actors],
            matchRules: [start.matchRules, mid.matchRules, afterLock.matchRules, afterOff.matchRules, end.matchRules],
        }});

        // idle cost without seconds: pause the player, leave only minute widgets
        players[0].status = 'Paused';
        players[0].changed(['PlaybackStatus']);
        await sleep(500);
        write({info: 'seconds wanted by', who: widgets().map(w => w.get_style_class_name())});
        await idle('music paused, analog clocks still shown', 4000);
        write({errors: errors()});
    }

    disable() {}
}
