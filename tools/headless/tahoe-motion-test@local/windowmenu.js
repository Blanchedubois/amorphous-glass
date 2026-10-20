// The window menu (a right-click on a GTK header bar, then Alt+Space), slowed down 8x, with
// screenshots and the drop's geometry against the click: it should pour out of the pointer (or,
// from the keyboard, out of the title bar corner Mutter gives). TAHOE_TEST_ONLY=windowmenu
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const OUT = GLib.getenv('TAHOE_TEST_OUT');
const SLOW = 8;

async function shotRect(name, [x, y, w, h]) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(x, y, w, h, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

export async function runWindowMenuShots(write) {
    const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
    const mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const t = () => GLib.get_monotonic_time();
    const key = async (...keys) => {
        keys.forEach(k => keyboard.notify_keyval(t(), k, Clutter.KeyState.PRESSED));
        await sleep(20);
        [...keys].reverse().forEach(k => keyboard.notify_keyval(t(), k, Clutter.KeyState.RELEASED));
    };
    GLib.spawn_async(null, ['gjs', `${GLib.getenv('TAHOE_TEST_TOOLS')}/stress-window.js`], null, GLib.SpawnFlags.SEARCH_PATH, null);
    let win = null;
    for (let i = 0; i < 100 && !win; i++) {
        await sleep(50);
        win = global.get_window_actors().map(a => a.meta_window).find(w => w.get_gtk_application_id?.() === 'org.tahoe.StressWindow');
    }
    if (!win) {
        write({ error: 'no GTK window' });
        return;
    }
    await sleep(600);
    win.move_frame(true, 500, 300);
    win.activate(global.get_current_time());
    await sleep(500);
    const motion = () => Main.extensionManager.lookup('tahoe-motion@cachyos-tahoe')?.stateObj;
    const menu = () => Main.wm._windowMenuManager._manager.activeMenu;
    const area = [400, 250, 700, 520];
    const trace = label => {
        const box = menu()?._boxPointer;
        const m = box && motion()?._morphs?.get(box);
        const p = m?.pieces?.[0];
        const [tx, ty] = p?.circle ? p.target.get_transformed_position() : [0, 0];
        write({ label, morph: Boolean(m), opening: m?.opening, frames: m?.frames, scale: box?.scale_x?.toFixed(3), opacity: box?.opacity,
            circle_stage: p?.circle ? [Math.round(tx + p.circle.x + p.circle.width / 2), Math.round(ty + p.originY)] : null,
            reveal: p?.lastRect ? Object.values(p.lastRect).map(Math.round) : null });
    };
    const r = win.get_frame_rect();
    const click = [r.x + 300, r.y + 22];
    write({ note: 'click', click, frame: [r.x, r.y, r.width, r.height] });
    // a first click into the window (the first right-click after it maps opens nothing)
    mouse.notify_absolute_motion(t(), r.x + 300, r.y + 200);
    await sleep(30);
    mouse.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await sleep(30);
    mouse.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await sleep(300);
    St.Settings.get().slow_down_factor = SLOW;
    mouse.notify_absolute_motion(t(), ...click);
    await sleep(30);
    mouse.notify_button(t(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
    await sleep(30);
    mouse.notify_button(t(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
    for (let i = 0; i < 10; i++) {
        await sleep(30 * SLOW);
        trace(`open-${i}`);
        await shotRect(`wm-open-${i}`, area);
    }
    await key(Clutter.KEY_Escape);
    for (let i = 0; i < 6; i++) {
        await sleep(25 * SLOW);
        trace(`close-${i}`);
        await shotRect(`wm-close-${i}`, area);
    }
    await sleep(2000);
    // Alt+Space, the pointer away from the window
    mouse.notify_absolute_motion(t(), 2000, 1200);
    win.activate(global.get_current_time());
    await sleep(300);
    await key(Clutter.KEY_Alt_L, Clutter.KEY_space);
    for (let i = 0; i < 6; i++) {
        await sleep(40 * SLOW);
        trace(`key-${i}`);
        await shotRect(`wm-key-${i}`, area);
    }
    St.Settings.get().slow_down_factor = 1;
    await key(Clutter.KEY_Escape);
    await sleep(800);
    win.delete(global.get_current_time());
    await sleep(500);
}
