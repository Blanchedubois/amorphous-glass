// A tour of the desktop's surfaces in the throwaway headless shell (TAHOE_TEST_ONLY=survey, with
// TAHOE_TEST_USERLOOK=1): a still of each, to see which already have Liquid Glass and which do
// not. Shell surfaces first, then GTK apps opened inside the test shell (Files, Settings, a file
// chooser, Text Editor, Calculator). Lock screen left out (its own session works on it).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const OUT = GLib.getenv('TAHOE_TEST_OUT');

async function shot(name) {
    const file = Gio.File.new_for_path(`${OUT}/survey-${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot(false, stream,
        (o, res) => { try { o.screenshot_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

// apps get settings of their own in memory: writing to the test shell's keyfile made it reload
// every key at once, which GLib aborts on (256 or more)
function spawn(argv) {
    try {
        const env = GLib.environ_setenv(GLib.get_environ(), 'GSETTINGS_BACKEND', 'memory', true);
        GLib.spawn_async(null, argv, env, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (e) {
        return `${e}`;
    }
    return null;
}

const windows = () => global.display.list_all_windows().filter(w => w.get_window_type() === Meta.WindowType.NORMAL);
async function waitWindow(test, ms = 8000) {
    for (let t = 0; t < ms; t += 200) {
        const w = windows().find(test);
        if (w)
            return w;
        await sleep(200);
    }
    return null;
}

export async function runSurvey(write) {
    const step = async (name, fn, settle = 900) => {
        try {
            const note = await fn();
            await sleep(settle);
            await shot(name);
            write({ survey: name, note: note ?? null });
        } catch (e) {
            write({ survey: name, error: `${e}` });
        }
    };
    const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
    const mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const t = () => GLib.get_monotonic_time();
    for (let i = 0; i < 10; i++) {
        mouse.notify_absolute_motion(t(), 1200 + i, 900);
        await sleep(30);
    }
    const key = async (...keys) => {
        for (const k of keys)
            keyboard.notify_keyval(t(), k, Clutter.KeyState.PRESSED);
        await sleep(40);
        for (const k of keys.reverse())
            keyboard.notify_keyval(t(), k, Clutter.KeyState.RELEASED);
    };

    await sleep(1500);
    await step('01-desktop', () => null);
    await step('02-overview', () => Main.overview.show(), 1200);
    await step('04-app-grid', () => {
        Main.overview.dash?.showAppsButton?.set_checked(true);
        Main.overview._overview?.controls?._toggleAppsPage?.();
        return Main.overview._overview?.controls?.dash?.showAppsButton?.checked;
    }, 2000);
    await step('05-app-folder', () => {
        const display = Main.overview._overview?.controls?._appDisplay;
        const folder = display?._folderIcons?.[0] ?? display?._orderedItems?.find(i => i.constructor.name === 'FolderIcon');
        if (!folder)
            return 'no folder in the app grid';
        folder.open?.() ?? folder._ensureFolderDialog?.();
        return `folder ${folder.name ?? folder._name ?? ''}`;
    }, 1500);
    await step('03-search', async () => {
        await key(Clutter.KEY_Escape);
        await sleep(400);
        Main.overview.searchEntry?.set_text('se');
    }, 1500);
    await step('06-overview-closed', async () => {
        Main.overview.searchEntry?.set_text('');
        await key(Clutter.KEY_Escape);
        await sleep(400);
        Main.overview.hide();
    }, 1200);

    // apps: a few windows for the window-level surfaces
    const errors = [
        spawn(['nautilus', '--new-window', GLib.get_home_dir()]),
        spawn(['gnome-text-editor', '--new-window']),
        spawn(['gnome-calculator']),
    ].filter(Boolean);
    const files = await waitWindow(w => (w.get_wm_class() ?? '').toLowerCase().includes('nautilus'));
    await waitWindow(w => (w.get_wm_class() ?? '').toLowerCase().includes('texteditor'));
    await waitWindow(w => (w.get_wm_class() ?? '').toLowerCase().includes('calculator'));
    write({ survey: 'apps', windows: windows().map(w => `${w.get_wm_class()} ${w.get_title()}`), errors });
    await step('07-windows', () => null, 1500);
    if (files) {
        await step('08-files', () => {
            files.activate(global.get_current_time());
            files.maximize?.(Meta.MaximizeFlags.BOTH);
        }, 1500);
        await step('09-files-menu', async () => {
            const rect = files.get_frame_rect();
            mouse.notify_absolute_motion(t(), rect.x + rect.width / 2, rect.y + rect.height / 2);
            await sleep(100);
            mouse.notify_button(t(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
            await sleep(40);
            mouse.notify_button(t(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
        }, 1200);
        await key(Clutter.KEY_Escape);
        await step('10-window-menu', () => {
            files.unmaximize?.(Meta.MaximizeFlags.BOTH);
            const rect = files.get_frame_rect();
            Main.wm._windowMenuManager.showWindowMenuForWindow(files, Meta.WindowMenuType.WM,
                new Mtk.Rectangle({ x: rect.x + 60, y: rect.y + 20, width: 0, height: 0 }));
        }, 900);
        await key(Clutter.KEY_Escape);
    }
    await step('11-alt-tab', async () => {
        keyboard.notify_keyval(t(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(t(), Clutter.KEY_Tab, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(t(), Clutter.KEY_Tab, Clutter.KeyState.RELEASED);
    }, 900);
    keyboard.notify_keyval(t(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await sleep(500);
    await step('12-osd', () => {
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('audio-volume-medium-symbolic'), 'Volume', 0.6);
    }, 400);
    await step('13-run-dialog', () => Main.openRunDialog(), 900);
    await key(Clutter.KEY_Escape);
    await step('14-screenshot-ui', () => Main.screenshotUI?.open(), 1500);
    await key(Clutter.KEY_Escape);
    await sleep(600);
    await step('15-banner', () => Main.notify('Liquid Glass survey', 'A notification banner over the desktop'), 900);
    await step('15b-notification-list', () => Main.panel.statusArea.dateMenu.menu.open(true), 1200);
    Main.panel.statusArea.dateMenu.menu.close(false);
    await sleep(400);
    await step('16-file-chooser', () => spawn(['zenity', '--file-selection', '--directory', `--filename=${GLib.get_home_dir()}/`]), 3000);
    await key(Clutter.KEY_Escape);
    await step('17-settings', () => spawn(['gnome-control-center', 'wifi']), 4000);
    await step('18-dialog', () => spawn(['zenity', '--question', '--text=Liquid Glass survey: a GTK dialog']), 2500);
    await key(Clutter.KEY_Escape);
}
