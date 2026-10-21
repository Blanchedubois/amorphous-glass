// Showcase driver (dev only, never part of the install; docs/SHOWCASE_PLAN.md): lets the shoot
// script (tools/showcase/shoot.py) move the pointer, click and press keys through a virtual input
// device, find where things are on screen, and take lossless screenshots, over the session bus.
// The input is real input, so every animation starts where a hand would have started it.
// Fixed methods only: no Eval, no file access beyond writing screenshots to a path the caller names.
// Enable for a shoot, disable after: gnome-extensions disable showcase@local.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `
<node>
  <interface name="org.cachyos.TahoeShowcase">
    <method name="Ping"><arg type="s" direction="out" name="version"/></method>
    <method name="Move"><arg type="i" name="x"/><arg type="i" name="y"/><arg type="u" name="ms"/></method>
    <method name="Click"><arg type="i" name="x"/><arg type="i" name="y"/><arg type="u" name="button"/></method>
    <method name="Scroll"><arg type="i" name="x"/><arg type="i" name="y"/><arg type="i" name="steps"/></method>
    <method name="Drag"><arg type="i" name="x1"/><arg type="i" name="y1"/><arg type="i" name="x2"/><arg type="i" name="y2"/><arg type="u" name="ms"/></method>
    <method name="Keys"><arg type="as" name="keys"/></method>
    <method name="Type"><arg type="s" name="text"/></method>
    <method name="Locate"><arg type="s" name="what"/><arg type="(iiii)" direction="out" name="box"/></method>
    <method name="Shot"><arg type="s" name="path"/></method>
    <method name="Frames"><arg type="s" name="dir"/><arg type="u" name="count"/><arg type="u" name="interval_ms"/><arg type="u" name="taken" direction="out"/></method>
    <method name="CloseAll"/>
    <method name="Notify"><arg type="s" name="title"/><arg type="s" name="body"/></method>
  </interface>
</node>`;

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const now = () => GLib.get_monotonic_time();

function box(actor) {
    if (!actor?.get_stage?.() || !actor.mapped)
        return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
}

// every mapped actor under root, depth first
function* walk(root) {
    const stack = [root];
    while (stack.length) {
        const a = stack.pop();
        if (!a.mapped)
            continue;
        yield a;
        stack.push(...a.get_children().reverse());
    }
}

// what: 'quick-settings', 'date', 'activities', 'status:<statusArea key>', 'dock:<app id>',
// 'qs-arrow:<n>' (the n-th quick settings toggle with a submenu), 'qs-toggle:<n>', 'menu' (the open
// menu's box), 'widget:<n>' (the n-th desktop widget), 'app-grid:<app id>', 'folder:<n>', 'window:<app id>'
function locate(what) {
    const [kind, arg] = what.split(/:(.*)/s);
    const area = Main.panel.statusArea;
    switch (kind) {
    case 'quick-settings': return box(area.quickSettings);
    case 'date': return box(area.dateMenu);
    case 'activities': return box(area.activities ?? area['kiwimenu']);
    case 'status': return box(area[arg]);
    case 'menu': return box(Main.panel.menuManager.activeMenu?._boxPointer ?? null);
    case 'dock':
    case 'app-grid': {
        // dock: an icon outside the overview's own grid; app-grid: inside it
        for (const a of walk(global.stage)) {
            if (a.app?.get_id?.() !== `${arg}.desktop` && a.app?.get_id?.() !== arg)
                continue;
            const inGrid = Boolean(findAncestor(a, p => p.constructor?.name === 'AppDisplay'));
            if ((kind === 'app-grid') === inGrid)
                return box(a);
        }
        return null;
    }
    case 'folder': {
        const folders = [...walk(global.stage)].filter(a => a.constructor?.name === 'FolderIcon');
        return box(folders[Number(arg)] ?? null);
    }
    case 'qs-arrow':
    case 'qs-toggle': {
        const grid = area.quickSettings?.menu?._grid;
        const toggles = (grid?.get_children() ?? []).filter(c => c.mapped && (kind === 'qs-toggle' || c.menu));
        const t = toggles[Number(arg)];
        return box(kind === 'qs-arrow' ? (t?._menuButton ?? t) : t);
    }
    case 'widget': {
        const w = [...walk(global.stage)].filter(a => a.has_style_class_name?.('tahoe-widget'));
        return box(w[Number(arg)] ?? null);
    }
    case 'window': {
        const win = global.get_window_actors().map(a => a.meta_window)
            .find(w => [w.get_gtk_application_id?.(), w.get_wm_class?.(), w.get_wm_class_instance?.()].includes(arg));
        if (!win)
            return null;
        const r = win.get_frame_rect();
        return [r.x, r.y, r.width, r.height];
    }
    }
    return null;
}

function findAncestor(a, test) {
    for (let p = a.get_parent(); p; p = p.get_parent())
        if (test(p))
            return p;
    return null;
}

// On the lock screen the driver only takes screenshots: no pointer, no keys, no menus
// (metadata.json keeps it alive in the unlock-dialog session mode for the lock screen shots).
const INPUT = new Set(['Move', 'Click', 'Scroll', 'Drag', 'Keys', 'Type', 'CloseAll', 'Notify']);

export default class Showcase extends Extension {
    enable() {
        const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
        this._mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const self = this;
        const guarded = new Proxy(this, {
            get(target, prop) {
                const name = String(prop).replace(/Async$/, '');
                if (INPUT.has(name) && Main.sessionMode.isLocked)
                    return (params, invocation) => invocation.return_error_literal(Gio.DBusError, Gio.DBusError.ACCESS_DENIED,
                        'the screen is locked: the showcase driver only takes screenshots here');
                const v = Reflect.get(target, prop);
                return typeof v === 'function' ? v.bind(self) : v;
            },
        });
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, guarded);
        this._dbus.export(Gio.DBus.session, '/org/cachyos/TahoeShowcase');
        this._name = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.cachyos.TahoeShowcase',
            Gio.BusNameOwnerFlags.NONE, null, null);
        [this._x, this._y] = global.get_pointer();
    }

    disable() {
        Gio.bus_unown_name(this._name);
        this._dbus.unexport();
        this._dbus = null;
        this._mouse = this._keyboard = null;
        this._source?.destroy();
        this._source = null;
    }

    PingAsync(params, invocation) {
        invocation.return_value(new GLib.Variant('(s)', [`${this.metadata.version ?? 1}`]));
    }

    // async methods return when the input has been delivered (the caller times the shots)
    MoveAsync([x, y, ms], invocation) {
        this._glide(x, y, ms).then(() => invocation.return_value(null), e => invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, `${e}`));
    }

    async _glide(x, y, ms) {
        [this._x, this._y] = global.get_pointer();
        const [x0, y0] = [this._x, this._y];
        const steps = Math.max(1, Math.round(ms / 8));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;   // ease in-out, as a hand moves
            this._mouse.notify_absolute_motion(now(), x0 + (x - x0) * e, y0 + (y - y0) * e);
            if (steps > 1)
                await sleep(8);
        }
        [this._x, this._y] = [x, y];
    }

    ClickAsync([x, y, button], invocation) {
        (async () => {
            this._mouse.notify_absolute_motion(now(), x, y);
            await sleep(16);
            this._mouse.notify_button(now(), button || 1, Clutter.ButtonState.PRESSED);
            await sleep(60);
            this._mouse.notify_button(now(), button || 1, Clutter.ButtonState.RELEASED);
        })().then(() => invocation.return_value(null));
    }

    ScrollAsync([x, y, steps], invocation) {
        (async () => {
            this._mouse.notify_absolute_motion(now(), x, y);
            for (let i = 0; i < Math.abs(steps); i++) {
                this._mouse.notify_discrete_scroll(now(), steps > 0 ? Clutter.ScrollDirection.DOWN : Clutter.ScrollDirection.UP,
                    Clutter.ScrollSource.WHEEL);
                await sleep(40);
            }
        })().then(() => invocation.return_value(null));
    }

    DragAsync([x1, y1, x2, y2, ms], invocation) {
        (async () => {
            this._mouse.notify_absolute_motion(now(), x1, y1);
            await sleep(30);
            this._mouse.notify_button(now(), 1, Clutter.ButtonState.PRESSED);
            await sleep(120);
            await this._glide(x2, y2, ms);
            await sleep(80);
            this._mouse.notify_button(now(), 1, Clutter.ButtonState.RELEASED);
        })().then(() => invocation.return_value(null));
    }

    // keys: X keysym names held together, e.g. ['Super_L'] or ['Alt_L', 'Tab']. The lock keys are
    // refused: locking and unlocking stay with the user (their password is never typed here).
    KeysAsync([keys], invocation) {
        const syms = keys.map(k => Clutter[`KEY_${k}`]);
        const lower = keys.map(k => k.toLowerCase());
        if (syms.some(s => s === undefined) || (lower.some(k => k.startsWith('super')) && lower.includes('l'))) {
            invocation.return_error_literal(Gio.DBusError, Gio.DBusError.INVALID_ARGS, `refused keys ${keys}`);
            return;
        }
        (async () => {
            for (const s of syms) {
                this._keyboard.notify_keyval(now(), s, Clutter.KeyState.PRESSED);
                await sleep(30);
            }
            await sleep(60);
            for (const s of [...syms].reverse()) {
                this._keyboard.notify_keyval(now(), s, Clutter.KeyState.RELEASED);
                await sleep(20);
            }
        })().then(() => invocation.return_value(null));
    }

    TypeAsync([text], invocation) {
        (async () => {
            for (const ch of text) {
                const sym = Clutter.unicode_to_keysym(ch.codePointAt(0));
                this._keyboard.notify_keyval(now(), sym, Clutter.KeyState.PRESSED);
                this._keyboard.notify_keyval(now(), sym, Clutter.KeyState.RELEASED);
                await sleep(70);
            }
        })().then(() => invocation.return_value(null));
    }

    LocateAsync([what], invocation) {
        const b = locate(what) ?? [-1, -1, 0, 0];
        invocation.return_value(new GLib.Variant('((iiii))', [b]));
    }

    ShotAsync([path], invocation) {
        const file = Gio.File.new_for_path(path);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        new Shell.Screenshot().screenshot(false, stream, (o, res) => {
            try {
                o.screenshot_finish(res);
                stream.close(null);
                invocation.return_value(null);
            } catch (e) {
                invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, `${e}`);
            }
        });
    }

    // count screenshots into dir (f00000.png, ...), one every interval_ms; returns how many were taken
    FramesAsync([dir, count, interval], invocation) {
        (async () => {
            let taken = 0;
            for (let i = 0; i < count; i++) {
                const t0 = GLib.get_monotonic_time();
                const file = Gio.File.new_for_path(`${dir}/f${String(i).padStart(5, '0')}.png`);
                const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
                try {
                    await new Promise((resolve, reject) => new Shell.Screenshot().screenshot(false, stream,
                        (o, res) => { try { o.screenshot_finish(res); resolve(); } catch (e) { reject(e); } }));
                    taken++;
                } catch (e) {
                    logError(e, 'showcase frame');
                }
                stream.close(null);
                const spent = (GLib.get_monotonic_time() - t0) / 1000;
                await sleep(Math.max(0, interval - spent));
            }
            return taken;
        })().then(n => invocation.return_value(new GLib.Variant('(u)', [n])));
    }

    CloseAllAsync(params, invocation) {
        Main.panel.menuManager.activeMenu?.close();
        Main.wm._windowMenuManager?._manager?.activeMenu?.close();
        if (Main.overview.visible)
            Main.overview.hide();
        invocation.return_value(null);
    }

    // a demo notification, so no real one has to appear on camera
    NotifyAsync([title, body], invocation) {
        if (!this._source) {
            this._source = new MessageTray.Source({ title: 'Liquid Glass', iconName: 'preferences-desktop-theme-symbolic' });
            this._source.connect('destroy', () => { this._source = null; });
            Main.messageTray.add(this._source);
        }
        this._source.addNotification(new MessageTray.Notification({ source: this._source, title, body }));
        invocation.return_value(null);
    }
}
