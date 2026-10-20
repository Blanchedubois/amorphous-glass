// Stress cases for tahoe-motion and the Blur My Shell glass (tools/headless): spam clicks and quick
// scrolls through a virtual pointer, in the throwaway headless shell only. For each case: frame
// stats while it runs, frames in the idle second after it (nothing should keep animating), the
// end state (every popup closed, no glass left frozen or held), and counts before and after
// (handlers, actors, memory) to catch anything that piles up.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

function rss() {
    const [, bytes] = GLib.file_get_contents('/proc/self/status');
    const m = new TextDecoder().decode(bytes).match(/VmRSS:\s+(\d+)/);
    return m ? Number(m[1]) : 0;
}

function countActors(actor = global.stage) {
    let n = 1;
    for (const child of actor.get_children())
        n += countActors(child);
    return n;
}

function centre(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x + w / 2, y + h / 2];
}

function findActor(root, test) {
    const stack = [root];
    while (stack.length) {
        const a = stack.pop();
        if (test(a))
            return a;
        stack.push(...a.get_children());
    }
    return null;
}

export async function runStress(write) {
    const seat = (global.stage.get_context?.()?.get_backend?.() ?? global.backend).get_default_seat();
    const mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const t = () => GLib.get_monotonic_time();
    const move = (x, y) => mouse.notify_absolute_motion(t(), x, y);
    const click = async (button, [x, y], hold = 30) => {
        move(x, y);
        await sleep(8);
        mouse.notify_button(t(), button, Clutter.ButtonState.PRESSED);
        await sleep(hold);
        mouse.notify_button(t(), button, Clutter.ButtonState.RELEASED);
    };
    const left = p => click(Clutter.BUTTON_PRIMARY, p);
    const right = p => click(Clutter.BUTTON_SECONDARY, p);
    const scroll = async ([x, y], up, n = 1) => {
        move(x, y);
        await sleep(8);
        for (let i = 0; i < n; i++) {
            mouse.notify_discrete_scroll(t(), up ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN,
                Clutter.ScrollSource.WHEEL);
            await sleep(12);
        }
    };
    const escape = async () => {
        // GNOME sometimes opens the overview at startup: over the desktop it took the desktop's
        // right-clicks (the "covered desktop" of earlier runs)
        if (Main.overview.visible)
            Main.overview.hide();
        Main.panel.menuManager.activeMenu?.close({ animate: false });
        desktopMenu()?.close({ animate: false });
        dockMenu()?.close({ animate: false });
        await sleep(300);
    };

    const glass = () => globalThis.__tahoeGlass?.debug?.() ?? {};
    const motion = () => Main.extensionManager.lookup('tahoe-motion@cachyos-tahoe')?.stateObj?.debug?.() ?? {};
    const qs = Main.panel.statusArea.quickSettings;
    const date = Main.panel.statusArea.dateMenu;
    // looked up each time: the shell rebuilds the background and its menu when the wallpaper
    // changes (Dark Style switches it)
    const desktopMenu = () => Main.layoutManager._backgroundGroup.get_children().find(a => a._backgroundMenu)?._backgroundMenu;
    const dockIcon = () => findActor(Main.uiGroup, a => a.constructor?.name?.includes('AppIcon') && a.mapped && a.reactive);
    const dockMenu = () => dockIcon()?._menu ?? null;

    // frame recording
    let frames = null;
    let t0 = 0;
    const ids = [
        global.stage.connect('before-update', () => (t0 = t())),
        global.stage.connect('after-update', () => frames?.push([t(), t() - t0])),
    ];
    const stats = list => {
        const iv = [];
        for (let i = 1; i < list.length; i++) iv.push((list[i][0] - list[i - 1][0]) / 1000);
        const active = iv.filter(x => x < 150).sort((a, b) => a - b);
        const q = p => active.length ? Math.round(active[Math.min(active.length - 1, Math.floor(active.length * p))] * 10) / 10 : 0;
        return { frames: list.length, p95: q(0.95), max: q(1), slow: active.filter(x => x > 12.5).length };
    };

    // how much each case really did: popups opened (BoxPointer.open, app popup windows mapped) and
    // the largest one-frame jump of a card's glass, as a share of the card (a reversed animation
    // should carry on from where it was, not restart: no jump near 1)
    let opens = 0;
    let appMaps = 0;
    let jump = 0;
    const proto = BoxPointer.BoxPointer.prototype;
    const boxOpen = proto.open;
    proto.open = function (...args) {
        opens++;
        return boxOpen.apply(this, args);
    };
    const mapId = global.window_manager.connect('map', (_, actor) => {
        if (actor.meta_window?.get_window_type() !== 0)
            appMaps++;
    });
    // per 120 Hz frame: a frame the shell dropped is not a jump
    const lastHeights = new Map();
    const lastTraces = new Map();
    let jumpTrace = '';
    let lastSample = 0;
    const sampleId = global.stage.connect('after-update', () => {
        const now = t();
        const frameShare = lastSample ? Math.max(1, (now - lastSample) / 8333) : 1;
        lastSample = now;
        const morphs = Main.extensionManager.lookup('tahoe-motion@cachyos-tahoe')?.stateObj?._morphs;
        for (const [key, morph] of morphs ?? []) {
            const piece = morph.pieces?.find(p => p.ready && p.lastRect && p.card);
            if (!piece)
                continue;
            const h = piece.lastRect.height / Math.max(1, piece.card.height);
            const last = lastHeights.get(key);
            const trace = [...(lastTraces.get(key) ?? []), `${Math.round(h * 100) / 100}${piece.constructor.name[0]}${morph.opening ? 'o' : 'c'}`].slice(-8);
            lastTraces.set(key, trace);
            if (last !== undefined && frames && Math.abs(h - last) / frameShare > jump) {
                jump = Math.abs(h - last) / frameShare;
                jumpTrace = trace.join(' ');
            }
            lastHeights.set(key, h);
        }
        for (const key of [...lastHeights.keys()])
            if (!morphs?.has(key)) {
                lastHeights.delete(key);
                lastTraces.delete(key);
            }
    });

    const snapshot = () => ({ glass: glass(), motion: motion(), actors: countActors(), rss: rss() });

    // TAHOE_STRESS_CASES: a regular expression, only the cases it matches
    const only = GLib.getenv('TAHOE_STRESS_CASES');
    async function runCase(name, cycles, step) {
        if (only && !new RegExp(only, 'i').test(name))
            return;
        await escape();
        await sleep(400);
        const before = snapshot();
        opens = appMaps = 0;
        jump = 0;
        jumpTrace = '';
        frames = [];
        let error = null;
        try {
            for (let i = 0; i < cycles; i++)
                await step(i);
        } catch (e) {
            error = `${e}`;
        }
        const busy = stats(frames);
        const did = { opens, app_maps: appMaps, max_jump: Math.round(jump * 100) / 100, jump_trace: jumpTrace };
        await sleep(700);
        await escape();
        await sleep(600);
        // idle: nothing should still be animating
        frames = [];
        await sleep(1000);
        const idle = frames.length;
        frames = null;
        const after = snapshot();
        const g = after.glass;
        const m = after.motion;
        // something reactive left over the desktop swallows its right-clicks (seen in some runs)
        const hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, 500, 300);
        let cover = null;
        if (hit && hit.constructor.name !== 'Meta_BackgroundActor') {
            const chain = [];
            for (let a = hit; a; a = a.get_parent())
                chain.push(`${a.constructor.name}${a.name ? `#${a.name}` : ''}${a.style_class ? `.${a.style_class}` : ''}`);
            const [w, h] = hit.get_transformed_size();
            const [x, y] = hit.get_transformed_position();
            cover = `desktop covered by ${chain.join(' < ')} at ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)} op${hit.opacity} vis${hit.visible} delegate:${hit._delegate?.constructor?.name}`;
        }
        const stuck = [
            cover,
            Main.panel.menuManager.activeMenu ? 'panel menu open' : null,
            ...Main.layoutManager._backgroundGroup.get_children().flatMap(b => b.get_actions())
                .filter(a => a.state !== undefined && a.state !== Clutter.GestureState.WAITING)
                .map(a => `desktop ${a.constructor.name} stuck in ${Object.keys(Clutter.GestureState).find(k => Clutter.GestureState[k] === a.state)}`),
            Main.modalCount > 1 ? `modal ${Main.modalCount} (${Main.modalActorFocusStack?.map(e => e.actor?.constructor.name).join(',')})` : null,
            global.stage.get_grab_actor?.() && global.stage.get_grab_actor() !== global.stage ? `grab ${global.stage.get_grab_actor().constructor.name}` : null,
            qs.menu._grid?.get_children().some(c => c.menu?.isOpen) ? 'a quick settings submenu open' : null,
            qs.menu._boxPointer.visible ? 'quick settings visible' : null,
            date.menu._boxPointer.visible ? 'calendar visible' : null,
            desktopMenu()?._boxPointer.visible ? 'desktop menu visible' : null,
            g.holds ? `${g.holds} holds` : null,
            g.settling ? `${g.settling} settling` : null,
            g.frozen ? `${g.frozen} frozen` : null,
            g.frame_callbacks ? `${g.frame_callbacks} frame callbacks` : null,
            m.morphs ? `${m.morphs} morphs` : null,
            m.closing_soon ? `${m.closing_soon} closing` : null,
            m.icon_timelines ? `${m.icon_timelines} icon timelines` : null,
        ].filter(Boolean);
        write({
            case: name, cycles, ...did, ...busy, idle_frames: idle, stuck, error,
            handlers: [before.glass.handlers, after.glass.handlers],
            actors: [before.actors, after.actors],
            rss_kb: [before.rss, after.rss],
            glass_after: g, motion_after: m,
        });
    }

    const dateButton = () => centre(date);
    const qsButton = () => centre(qs);
    const toggle = name => qs.menu._grid.get_children().find(c => c.constructor.name === name && c.visible);
    const arrow = t => t?._menuButton ? centre(t._menuButton) : null;

    await sleep(1500);
    // a first open of each, so later cases are not first opens
    for (const menu of [qs.menu, date.menu]) {
        menu.open(true);
        await sleep(700);
        menu.close(true);
        await sleep(500);
    }

    await runCase('spam click calendar icon (40 ms)', 14, () => left(dateButton()).then(() => sleep(40)));
    await runCase('spam click quick settings (40 ms)', 14, () => left(qsButton()).then(() => sleep(40)));
    await runCase('open-close-open mid spring (calendar, 60 ms)', 10, () => left(dateButton()).then(() => sleep(60)));
    await runCase('reverse mid-open, random 20-160 ms (calendar)', 16, () =>
        left(dateButton()).then(() => sleep(20 + Math.floor(Math.random() * 140))));
    await runCase('reverse mid-open, random 20-160 ms (quick settings)', 16, () =>
        left(qsButton()).then(() => sleep(20 + Math.floor(Math.random() * 140))));
    await runCase('alternate two panel icons (50 ms)', 14, i => left(i % 2 ? qsButton() : dateButton()).then(() => sleep(50)));
    await runCase('hover-slide between panel menus (30 ms)', 1, async () => {
        await left(dateButton());
        for (let i = 0; i < 20; i++) {
            move(...(i % 2 ? qsButton() : dateButton()));
            await sleep(30);
        }
    });
    await runCase('spam Dark Style toggle (40 ms)', 1, async () => {
        qs.menu.open(true);
        await sleep(600);
        const dark = toggle('DarkModeToggle');
        for (let i = 0; i < 12 && dark; i++) {
            await left(centre(dark));
            await sleep(40);
        }
    });
    await runCase('spam Wi-Fi submenu arrow (50 ms)', 1, async () => {
        qs.menu.open(true);
        await sleep(600);
        const wifi = toggle('NMWirelessToggle') ?? qs.menu._grid.get_children().find(c => c.menu && c.visible && c._menuButton);
        for (let i = 0; i < 12 && wifi; i++) {
            await left(arrow(wifi) ?? centre(wifi));
            await sleep(50);
        }
    });
    // a light/dark switch swaps the wallpaper: the shell rebuilds the background and its menu
    await runCase('desktop right-click after a wallpaper swap', 1, async () => {
        const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const scheme = iface.get_string('color-scheme');
        iface.set_string('color-scheme', scheme === 'prefer-dark' ? 'default' : 'prefer-dark');
        await sleep(2500);
        // what a right-click on the desktop reaches
        move(500, 300);
        await sleep(50);
        const under = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, 500, 300);
        const bgs = Main.layoutManager._backgroundGroup.get_children();
        write({ note: 'desktop', under: `${under?.constructor.name}.${under?.name ?? ''}`, under_menu: Boolean(under?._backgroundMenu),
            backgrounds: bgs.map(b => `${b.constructor.name} menu:${Boolean(b._backgroundMenu)} actions:${b.get_actions().map(a => a.constructor.name).join('+')} reactive:${b.reactive} op:${b.opacity}`),
            managers: (Main.layoutManager._bgManagers ?? []).length });
        for (let i = 0; i < 10; i++) {
            await right([400 + (i % 4) * 200, 300 + (i % 3) * 150]);
            await sleep(300);
        }
        iface.set_string('color-scheme', scheme);
        await sleep(2500);
        for (let i = 0; i < 10; i++) {
            await right([400 + (i % 4) * 200, 300 + (i % 3) * 150]);
            await sleep(300);
        }
    });
    await runCase('spam desktop right-click, moving (60 ms)', 14, i =>
        right([300 + (i % 5) * 220, 260 + (i % 3) * 180]).then(() => sleep(60)));
    await runCase('spam dock icon right-click (60 ms)', 1, async () => {
        const icon = dockIcon();
        if (!icon)
            throw new Error('no dock icon');
        for (let i = 0; i < 12; i++) {
            await right(centre(icon));
            await sleep(60);
        }
    });
    await runCase('scroll volume slider while quick settings opens', 1, async () => {
        await left(qsButton());
        await sleep(40);
        const slider = qs.menu._grid.get_children().find(c => c.constructor.name.includes('Slider') && c.visible);
        await scroll(centre(slider), true, 15);
        await scroll(centre(slider), false, 15);
    });
    await runCase('scroll top bar volume icon while menus animate', 1, async () => {
        await left(dateButton());
        const volumeIcon = Main.panel.statusArea.quickSettings._volumeOutput ?? qs;
        await scroll(centre(volumeIcon), true, 20);
        await scroll(centre(volumeIcon), false, 20);
    });
    await runCase('scroll calendar mid-open', 1, async () => {
        await left(dateButton());
        await sleep(30);
        const cal = date.menu.box;
        await scroll(centre(cal), true, 12);
        await scroll(centre(cal), false, 12);
    });
    const popover = (...args) => async () => {
        const dir = GLib.getenv('TAHOE_TEST_TOOLS');
        const [, pid] = GLib.spawn_async(null, ['gjs', `${dir}/stress-popover.js`, ...args], null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);
        await new Promise(resolve => GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => resolve()));
    };
    await runCase('app popover open/close, slow (700 ms, reference)', 1, popover('4', '700'));
    await runCase('app popover open/close fast (40 ms), quit open', 1, popover('25', '40', 'quit-open'));
    // closed with no animation in the middle of an open (menu.close({ animate: false }): the overview, the lock
    // screen, a grab lost): checked right after, not after the case's settle time
    const instant = async (menu, ms) => {
        menu.open(true);
        await sleep(ms);
        menu.close({ animate: false });
        await sleep(400);
        const m = motion();
        const g = glass();
        if (m.morphs || g.holds || g.frozen)
            throw new Error(`left after an instant close: ${m.morphs} morphs, ${g.holds} holds, ${g.frozen} frozen`);
    };
    await runCase('instant close mid-open (calendar, 40 ms)', 8, () => instant(date.menu, 40));
    await runCase('instant close mid-open (quick settings, 40 ms)', 8, () => instant(qs.menu, 40));
    await runCase('overview toggled while a menu opens', 4, async () => {
        await left(dateButton());
        await sleep(50);
        Main.overview.toggle();
        await sleep(700);
        Main.overview.toggle();
        await sleep(700);
    });
    // Liquid Glass everywhere, phase 1: the new glass surfaces, many times
    await runCase('dock label hover x30 (glass capsule)', 30, async i => {
        const icon = dockIcon();
        if (!icon)
            throw new Error('no dock icon');
        const [x, y] = centre(icon);
        move(x, y);
        await sleep(i % 3 ? 120 : 700);
        move(x, y - 300);
        await sleep(80);
    });
    await runCase('volume OSD x30 (glass HUD)', 30, async () => {
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('audio-volume-medium-symbolic'), 'Volume', Math.random());
        await sleep(90);
    });
    await runCase('app folder open/close x20 (glass)', 20, async () => {
        Main.overview.show();
        await sleep(300);
        const display = Main.overview._overview?.controls?._appDisplay;
        const folder = display?._folderIcons?.[0];
        if (!folder)
            throw new Error('no folder');
        folder.open();
        await sleep(250);
        folder._dialog?.popdown?.() ?? folder.view?._dialog?.popdown?.();
        await sleep(150);
        Main.overview.hide();
        await sleep(300);
    });
    // overview search in Liquid Glass (docs/gnome-tahoe/search-glass-plan.md): typing fast, panels
    // made, shown and hidden as results change, the results scrolled while they change
    await runCase('search typing fast x5 (glass panels)', 5, async () => {
        Main.overview.show();
        await sleep(500);
        const entry = Main.overview.searchEntry;
        const text = 'wifi password panel';
        for (let i = 1; i <= text.length; i++) {
            entry.set_text(text.slice(0, i));
            await sleep(40);
        }
        const find = (root, test) => { const st = [root]; while (st.length) { const a = st.pop(); if (test(a)) return a; st.push(...a.get_children()); } return null; };
        const view = find(Main.overview._overview, a => a.constructor.name === 'St_ScrollView' && a.mapped && a.has_style_class_name?.('search-display'));
        for (let i = 0; i < 10; i++) {
            view?.vadjustment?.set_value((i % 2) * (view.vadjustment.upper ?? 0));
            entry.set_text(i % 2 ? 'pa' : 'w');
            await sleep(60);
        }
        entry.set_text('');
        await sleep(200);
        Main.overview.hide();
        await sleep(400);
    });
    await runCase('leak check: calendar open/close x50', 50, async () => {
        date.menu.open(true);
        await sleep(90);
        date.menu.close(true);
        await sleep(60);
    });
    await runCase('leak check: quick settings open/close x50', 50, async () => {
        qs.menu.open(true);
        await sleep(90);
        qs.menu.close(true);
        await sleep(60);
    });
    await runCase('leak check: desktop right-click x50', 50, async i => {
        await right([400 + (i % 4) * 200, 300 + (i % 3) * 150]);
        await sleep(80);
    });

    ids.forEach(id => global.stage.disconnect(id));
    global.stage.disconnect(sampleId);
    global.window_manager.disconnect(mapId);
    proto.open = boxOpen;
}
