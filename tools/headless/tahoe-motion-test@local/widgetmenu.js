// The desktop menu with tahoe-widgets' "Add Widget" submenu: right-clicks, the submenu expanded
// and collapsed (the menu changes size while open), with screenshots and the glass's geometry
// against the menu's at each step. TAHOE_TEST_ONLY=widgetmenu, TAHOE_TEST_EXTS=tahoe-widgets@...
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const OUT = GLib.getenv('TAHOE_TEST_OUT');

async function shotRect(name, [x, y, w, h]) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(x, y, w, h, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

const rect = a => {
    if (!a)
        return null;
    const [x, y] = a.get_transformed_position();
    const [w, h] = a.get_transformed_size();
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
};

export async function runWidgetMenu(write) {
    const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
    const mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const t = () => GLib.get_monotonic_time();
    const click = async (button, [x, y]) => {
        mouse.notify_absolute_motion(t(), x, y);
        await sleep(10);
        mouse.notify_button(t(), button, Clutter.ButtonState.PRESSED);
        await sleep(30);
        mouse.notify_button(t(), button, Clutter.ButtonState.RELEASED);
    };
    const bg = Main.layoutManager._backgroundGroup.get_children().find(a => a._backgroundMenu)?._backgroundMenu;
    const bp = bg._boxPointer;
    const api = globalThis.__tahoeGlass;
    const sub = bg._tahoeWidgetsItems?.[0];
    write({ note: `widgets item: ${Boolean(sub)}` });

    const state = async (label, ms) => {
        await sleep(ms);
        const surfaces = api?.surfaces(bp) ?? [];
        write({
            label, open: bg.isOpen, bp: rect(bp), box: rect(bg.box), scale: bp.scale_x.toFixed(2),
            glass: surfaces.map(s => ({ target: rect(s.target), blur: rect(s.actor ?? s.blur_actor), frozen: s.frozen, settling: s.settling })),
            debug: api?.debug?.(), motion: Main.extensionManager.lookup('tahoe-motion@cachyos-tahoe')?.stateObj?.debug?.(),
        });
        const popups = [];
        const walk = a => {
            if (a.constructor.name === 'BoxPointer' && a.visible)
                popups.push({ popup: rect(a), opacity: a.opacity, scale: a.scale_x.toFixed(2), surfaces: api?.surfaces(a).length,
                    reveal: (api?.surfaces(a) ?? []).map(s => s._reveal ?? s.reveal ?? null) });
            a.get_children().forEach(walk);
        };
        walk(Main.uiGroup);
        const [px, py] = global.get_pointer();
        const under = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px, py);
        write({ label, popups, under: `${under?.constructor.name}.${under?.get_style_class_name?.() ?? ''}`, pointer: [px, py] });
        await shotRect(label, [0, 0, 2560, 1440]);
    };

    await sleep(1500);
    // the first events of a new virtual device are lost: move it about first
    for (let i = 0; i < 10; i++) {
        mouse.notify_absolute_motion(t(), 300 + i * 10, 300);
        await sleep(30);
    }
    await click(Clutter.BUTTON_SECONDARY, [600, 500]);
    await state('1-open-30ms', 30);
    await state('1-open-700ms', 670);
    const subAt = () => {
        const [x, y, w, h] = rect(sub);
        return [x + w / 2, y + h / 2];
    };
    // frame by frame: the menu's height against its glass's
    const trace = [];
    const traceId = global.stage.connect('after-update', () => {
        const g = api?.surfaces(bp)?.[0]?.glass_rect?.();
        trace.push(`${Math.round(bg.box.height)}/${g ? Math.round(g.height) : '-'}`);
    });
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await sleep(400);
    global.stage.disconnect(traceId);
    write({ expand_trace: trace.join(' ') });
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await sleep(500);
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await state('2-expand-40ms', 40);
    await state('2-expand-700ms', 660);
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await state('3-collapse-40ms', 40);
    await state('3-collapse-700ms', 660);
    // expanded quickly after opening (mid-animation)
    bg.close({ animate: false });
    await sleep(300);
    await click(Clutter.BUTTON_SECONDARY, [900, 600]);
    await sleep(60);
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await state('4-expand-mid-open-700ms', 700);
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await state('4-collapse-700ms', 700);
    // right-click elsewhere with the submenu expanded
    await click(Clutter.BUTTON_PRIMARY, subAt());
    await sleep(500);
    await click(Clutter.BUTTON_SECONDARY, [1400, 500]);
    await state('5-reopen-elsewhere-expanded-700ms', 700);
    // the user's case: a right-click, then one far away; the glass must blur what is behind it
    // there, not what was behind it at the first place
    for (const gap of [0, 120]) {
        bg.close({ animate: false });
        await sleep(300);
        await click(Clutter.BUTTON_SECONDARY, [500, 300]);
        await sleep(700);
        await click(Clutter.BUTTON_PRIMARY, [1900, 1100]);
        await sleep(gap);
        await click(Clutter.BUTTON_SECONDARY, [1800, 1000]);
        await state(`7-far-gap${gap}-40ms`, 40);
        await state(`7-far-gap${gap}-90ms`, 50);
        await state(`7-far-gap${gap}-700ms`, 610);
    }
    await click(Clutter.BUTTON_SECONDARY, [500, 300]);
    await sleep(80);
    await click(Clutter.BUTTON_SECONDARY, [700, 450]);
    await state('6-spam-reopen-700ms', 700);
}
