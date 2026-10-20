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
    // TAHOE_SURVEY_SEARCH=1: only the overview search (docs/gnome-tahoe/search-glass-plan.md)
    if (GLib.getenv('TAHOE_SURVEY_SEARCH') === '1') {
        const find = (root, test) => { const st = [root]; while (st.length) { const a = st.pop(); if (test(a)) return a; st.push(...a.get_children()); } return null; };
        const visible = cls => find(Main.overview._overview, a => a.mapped && a.has_style_class_name?.(cls));
        const at = a => { const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); return [x + w / 2, y + h / 2]; };
        // two list providers of our own (the real ones, Settings, Characters, Clocks, are other
        // apps over D-Bus, which the test shell cannot start)
        const provider = (id, app, words) => ({
            id, isRemote: false, canLaunchSearch: false,
            appInfo: Gio.DesktopAppInfo.new(app),
            getInitialResultSet: async terms => words.filter(w => terms.some(t => w.toLowerCase().includes(t.toLowerCase()))),
            getSubsearchResultSet: async (prev, terms) => prev.filter(w => terms.some(t => w.toLowerCase().includes(t.toLowerCase()))),
            getResultMetas: async ids => ids.map(w => ({ id: w, name: w, description: `${id} result: ${w}`, createIcon: size => new (imports.gi.St.Icon)({ icon_name: 'emblem-documents-symbolic', icon_size: size }) })),
            filterResults: (r, max) => r.slice(0, max),
            activateResult: () => {}, launchSearch: () => {}, createResultObject: () => null,
        });
        const controller = Main.overview.searchController ?? Main.overview._overview.controls._searchController;
        try {
            controller.addProvider(provider('tahoe-test-settings', 'org.gnome.Settings.desktop',
                ['Wi-Fi network', 'Power saving', 'Wellbeing', 'Mobile network', 'Wallpaper', 'Passwords', 'Panel', 'Parental']));
            controller.addProvider(provider('tahoe-test-files', 'org.gnome.Nautilus.desktop',
                ['wallpaper.png', 'passport.pdf', 'paint notes.txt', 'web page.html', 'walk.mp4', 'party.jpg']));
        } catch (e) { write({ survey: 'providers', error: `${e}` }); }
        Main.overview.show();
        await sleep(1200);
        Main.overview.searchEntry.grab_key_focus();
        await step('search-w', () => Main.overview.searchEntry.set_text('w'), 2500);
        const row = visible('list-search-result');
        if (row) await step('search-hover-row', () => { mouse.notify_absolute_motion(t(), ...at(row)); }, 600);
        const prov = visible('search-provider-icon');
        if (prov) await step('search-hover-provider', () => { mouse.notify_absolute_motion(t(), ...at(prov)); }, 600);
        {
            const results = find(Main.overview._overview, a => a.has_style_class_name?.('search-results-scrollview') || a.constructor.name === 'SearchResultsView');
            const seen = new Map(); const st = [results ?? Main.overview._overview];
            while (st.length) { const a = st.pop(); if (a.mapped) { const k = `${a.constructor.name}.${a.get_style_class_name?.() ?? ''}`; seen.set(k, (seen.get(k) ?? 0) + 1); } st.push(...a.get_children()); }
            write({ survey: 'result-classes', classes: [...seen.entries()].filter(([k]) => /search|icon|result|tile/i.test(k)).map(([k, n]) => `${k} x${n}`) });
        }
        const tile = find(Main.overview._overview, a => a.mapped && a.has_style_class_name?.('overview-tile') && a.get_parent()?.has_style_class_name?.('grid-search-results'));
        if (tile) {
            const chain = []; for (let a = tile; a && chain.length < 3; a = a.get_parent()) chain.push(`${a.constructor.name}.${a.get_style_class_name?.()}`);
            const kids = []; const st = [tile]; while (st.length) { const a = st.pop(); if (a !== tile && a.get_style_class_name?.()) kids.push(`${a.constructor.name}.${a.get_style_class_name()}`); st.push(...a.get_children()); }
            write({ survey: 'tile-classes', chain, kids: kids.slice(0, 8) });
        }
        if (tile) await step('search-hover-tile', () => { mouse.notify_absolute_motion(t(), ...at(tile)); }, 600);
        mouse.notify_absolute_motion(t(), 100, 700);
        await step('search-pa', () => Main.overview.searchEntry.set_text('pa'), 2500);
        await step('search-keys', async () => { Main.overview.searchEntry.grab_key_focus(); await key(Clutter.KEY_Down); await key(Clutter.KEY_Down); }, 600);
        // the provider labels against their panels: size, insets and corner radii, in px
        {
            const out = [];
            const st = [Main.overview._overview];
            while (st.length) {
                const a = st.pop();
                if (a.mapped && a.has_style_class_name?.('search-provider-icon')) {
                    let panel = a.get_parent();
                    while (panel && !panel.has_style_class_name?.('search-section-content')) panel = panel.get_parent();
                    const r = x => { const [px, py] = x.get_transformed_position(); const [w, h] = x.get_transformed_size(); return { x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 }; };
                    const L = r(a), Pn = panel ? r(panel) : null;
                    const glassApi = globalThis.__tahoeGlass;
                    let glass = null;
                    for (let r = panel; r && !glass; r = r.get_parent())
                        glass = glassApi?.surfaces?.(r)?.find(g => g.target === panel) ?? null;
                    out.push({ glass_radius: glass?.corner_radius ?? null, label: L, label_radius: a.get_theme_node().get_border_radius(0), pseudo: a.get_style_pseudo_class(),
                        panel: Pn, panel_radius: panel?.get_theme_node().get_border_radius(0),
                        inset_left: Pn && L.x - Pn.x, inset_top: Pn && L.y - Pn.y, capsule_end: L.h / 2,
                        wanted_panel_radius: Pn && (L.h / 2 + (L.x - Pn.x)) });
                }
                st.push(...a.get_children());
            }
            write({ survey: 'provider-geometry', out });
        }
        const view = find(Main.overview._overview, a => a.constructor.name === 'St_ScrollView' && a.mapped && find(a, b => b.has_style_class_name?.('search-section-content')));
        await step('search-scrolled', () => { view?.vadjustment?.set_value(view.vadjustment.upper); return view ? null : 'no scroll view'; }, 800);
        await step('search-scrolled-back', () => { view?.vadjustment?.set_value(0); }, 800);
        write({ survey: 'search-glass', surfaces: globalThis.__tahoeGlass?.debug?.() });
        await step('search-closing', () => Main.overview.hide(), 120);
        await step('search-closed', () => null, 1500);
        return;
    }
    // TAHOE_SURVEY_GRID=1: only the app grid (GNOME's own dash: run without dash-to-dock)
    if (GLib.getenv('TAHOE_SURVEY_GRID') === '1') {
        if (GLib.getenv('TAHOE_SURVEY_GRID_MOTION') === '1') {
            // the glass under folder tiles while the overview opens, a page flips and it closes
            const St = (await import('gi://St')).default;
            const settings = St.Settings.get();
            settings.slow_down_factor = 6;
            Main.overview.showApps();
            for (let i = 0; i < 6; i++) {
                await sleep(110 * 6 / 6 * 1.5);
                await shot(`grid-open-${i}`);
            }
            await sleep(2500);
            const display = Main.overview._overview?.controls?._appDisplay;
            display?.goToPage?.(1);
            for (let i = 0; i < 5; i++) {
                await sleep(150);
                await shot(`grid-page-${i}`);
            }
            await sleep(2500);
            display?.goToPage?.(0);
            await sleep(2500);
            await shot('grid-back');
            Main.overview.hide();
            for (let i = 0; i < 5; i++) {
                await sleep(150);
                await shot(`grid-close-${i}`);
            }
            settings.slow_down_factor = 1;
            await sleep(2000);
            await shot('grid-after');
            return;
        }
        await step('grid', () => Main.overview.showApps(), 2500);
        write({ survey: 'grid-glass', debug: globalThis.__tahoeGlass?.debug?.() });
        await step('grid-folder', () => {
            const folder = Main.overview._overview?.controls?._appDisplay?._folderIcons?.[0];
            folder?.open();
            return folder ? null : 'no folder';
        }, 1500);
        return;
    }
    await step('01-desktop', () => null);
    // the dock's app name: the pointer over the first dock icon
    await step('01b-dock-label', async () => {
        const icon = (() => {
            const stack = [Main.uiGroup];
            while (stack.length) {
                const a = stack.pop();
                if (a.constructor?.name?.includes('AppIcon') && a.mapped && a.reactive)
                    return a;
                stack.push(...a.get_children());
            }
            return null;
        })();
        if (!icon)
            return 'no dock icon';
        const [x, y] = icon.get_transformed_position();
        const [w, h] = icon.get_transformed_size();
        mouse.notify_absolute_motion(t(), x + w / 2, y + h / 2);
        return null;
    }, 1600);
    mouse.notify_absolute_motion(t(), 1200, 700);
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
    try {
        const find = (a, test) => { const st = [a]; while (st.length) { const x = st.pop(); if (test(x)) return x; st.push(...x.get_children()); } return null; };
        const entry = find(Main.layoutManager.modalDialogGroup, a => a.has_style_class_name?.('run-dialog-entry'));
        const chain = [];
        for (let a = entry; a && chain.length < 6; a = a.get_parent()) chain.push(`${a.constructor.name}.${a.get_style_class_name?.() ?? ''}:${a.get_style_pseudo_class?.() ?? ''}`);
        const node = entry?.get_theme_node();
        const c = node?.get_background_color();
        write({ survey: 'run-entry', chain, bg: c ? [c.red, c.green, c.blue, c.alpha] : null, border: node ? [node.get_border_width(0), node.get_border_width(1)] : null, radius: node?.get_border_radius(0), style: entry?.get_style() });
    } catch (e) { write({ survey: 'run-entry', error: `${e}` }); }
    await key(Clutter.KEY_Escape);
    await step('14-screenshot-ui', () => Main.screenshotUI?.open(), 1500);
    try {
        const st = [Main.screenshotUI]; const out = [];
        while (st.length) { const a = st.pop(); const c = a.get_style_class_name?.() ?? ''; if (/shot-cast/.test(c)) { const n = a.get_theme_node(); const b = n.get_background_color(); out.push(`${a.constructor.name}.${c}:${a.get_style_pseudo_class?.() ?? ''} bg ${[b.red, b.green, b.blue, b.alpha]}`); } st.push(...a.get_children()); }
        write({ survey: 'shot-cast', out });
    } catch (e) { write({ survey: 'shot-cast', error: `${e}` }); }
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
