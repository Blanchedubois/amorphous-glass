// Headless test driver (scratch, never installed on the real desktop): opens and closes the glass
// popups of a throwaway headless gnome-shell, logs frame intervals, the time the stage update took,
// Blur My Shell's tahoe_prof counters and JS errors, takes still screenshots once each popup has
// settled, then ends the shell. Output dir: $TAHOE_TEST_OUT.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('TAHOE_TEST_OUT');
const RUNS = Number(GLib.getenv('TAHOE_TEST_RUNS') ?? 5);
const OPEN_MS = Number(GLib.getenv("TAHOE_TEST_OPEN_MS") ?? 700);
const CLOSE_MS = 500;

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

function write(name, obj) {
    const f = Gio.File.new_for_path(`${OUT}/${name}`);
    const s = f.append_to(Gio.FileCreateFlags.NONE, null);
    s.write_all(new TextEncoder().encode(JSON.stringify(obj) + '\n'), null);
    s.close(null);
}

async function shot(name, actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const pad = 24;
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(
        Math.max(0, Math.floor(x - pad)), Math.max(0, Math.floor(y - pad)),
        Math.ceil(w + 2 * pad), Math.ceil(h + 2 * pad), stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

function stageBox(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const pad = 40;
    return [Math.max(0, Math.floor(x - pad)), Math.max(0, Math.floor(y - pad)), Math.ceil(w + 2 * pad), Math.ceil(h + 2 * pad)];
}

async function shotRect(name, [x, y, w, h]) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(x, y, w, h, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

function prof() {
    const p = globalThis.__tahoeProf;
    return p ? { time: { ...p.time }, count: { ...p.count } } : null;
}

function diff(a, b) {
    if (!a || !b) return null;
    const out = {};
    for (const k of Object.keys(b.count)) {
        const c = (b.count[k] ?? 0) - (a.count[k] ?? 0);
        const t = ((b.time[k] ?? 0) - (a.time[k] ?? 0)) / 1000;
        if (c || t) out[k] = [c, Math.round(t * 100) / 100];
    }
    return out;
}

export default class Driver extends Extension {
    enable() {
        this._frames = null;
        this._t0 = 0;
        this._ids = [
            global.stage.connect('before-update', () => { this._t0 = GLib.get_monotonic_time(); }),
            global.stage.connect('after-update', () => {
                if (this._frames) {
                    const p = globalThis.__tahoeProf;
                    this._frames.push([GLib.get_monotonic_time(), GLib.get_monotonic_time() - this._t0,
                        p ? Object.fromEntries(Object.entries(p.time).map(([k, v]) => [k, v])) : null,
                        p ? { ...p.count } : null]);
                }
            }),
        ];
        const p = globalThis.__tahoeProf;
        if (p) p.on = true;
        // a backdrop with detail behind the menus, so screenshots show the blur and refraction
        this._backdrop = Main.layoutManager._backgroundGroup;
        this.run().catch(e => write('log.jsonl', { error: `${e}\n${e.stack}` }))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
    }

    async measure(label, kind, fn, ms) {
        const p0 = prof();
        this._frames = [];
        const start = GLib.get_monotonic_time();
        fn();
        await sleep(ms);
        const frames = this._frames;
        this._frames = null;
        const iv = [];
        for (let i = 1; i < frames.length; i++) iv.push((frames[i][0] - frames[i - 1][0]) / 1000);
        write('log.jsonl', {
            label, kind,
            first_ms: frames.length ? (frames[0][0] - start) / 1000 : null,
            iv: iv.map(x => Math.round(x * 100) / 100),
            cpu: frames.map(f => Math.round(f[1] / 10) / 100),
            fcount: frames.map((f, i) => {
                const prev = i ? frames[i - 1][3] : p0?.count;
                const out = {};
                for (const k of Object.keys(f[3] ?? {})) {
                    const d = f[3][k] - (prev?.[k] ?? 0);
                    if (d > 0 && !k.startsWith('motion') && k !== 'surface.update') out[k] = d;
                }
                return out;
            }),
            ftime: frames.slice(0, 6).map((f, i) => {
                const prev = i ? frames[i - 1][2] : p0?.time;
                const out = {};
                for (const k of Object.keys(f[2] ?? {})) {
                    const d = (f[2][k] - (prev?.[k] ?? 0)) / 1000;
                    if (d > 0.05) out[k] = Math.round(d * 100) / 100;
                }
                return out;
            }),
            prof: diff(p0, prof()),
        });
    }

    async scenario(label, menu, shotActor, runs, before = null) {
        for (let i = 0; i < runs; i++) {
            if (before) await before();
            await this.measure(label, 'open', () => menu.open(true), OPEN_MS);
            if (i === runs - 1 && shotActor) {
                try { await shot(`${label}`, shotActor()); } catch (e) { write('log.jsonl', { label, shot_error: `${e}` }); }
            }
            await this.measure(label, 'close', () => menu.close(true), CLOSE_MS);
        }
    }

    async run() {
        await sleep(8000);
        write('log.jsonl', { start: true, animations: St_animations() });
        const qs = Main.panel.statusArea.quickSettings.menu;
        const date = Main.panel.statusArea.dateMenu.menu;
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'vitals') {
            const vitals = Main.panel.statusArea.vitalsMenu?.menu;
            vitals.open(true);
            await sleep(900);
            await shotRect('vitals-open', stageBox(vitals._boxPointer));
            const glass = globalThis.__tahoeGlass;
            write('log.jsonl', { surfaces: glass.surfaces(vitals._boxPointer).length, root: Boolean(glass.root_of(vitals.box)) });
            // one switch, as the pointer slides to the clock, slowed 6x
            St.Settings.get().slow_down_factor = 6;
            Main.panel.menuManager._changeMenu(date);
            for (let i = 0; i < 8; i++) {
                await shotRect(`switch-${i}`, [1000, 0, 1560, 620]);
                await sleep(25 * 6);
            }
            St.Settings.get().slow_down_factor = 1;
            date.close(false);
            await sleep(500);
            vitals.open(false);
            await sleep(600);
            write('log.jsonl', { surfaces2: glass.surfaces(vitals._boxPointer).length });
            await shotRect('vitals-open2', stageBox(vitals._boxPointer));
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'skim') {
            // sliding across the top bar as a hand does, through GNOME's own menu manager
            const manager = Main.panel.menuManager;
            const menus = ['vitalsMenu', 'dateMenu', 'quickSettings']
                .map(key => Main.panel.statusArea[key]?.menu).filter(Boolean);
            write('log.jsonl', { note: `menus: ${menus.length}` });
            const shots = GLib.getenv('TAHOE_TEST_SKIM_SHOTS') === '1';
            for (const [label, gap] of [['skim-fast-first', 70], ['skim-fast-again', 70], ['skim-slow', 450]]) {
                menus[0].open(true);
                await sleep(500);
                const p0 = prof();
                this._frames = [];
                const start = GLib.get_monotonic_time();
                let shot = 0;
                for (let round = 0; round < 2; round++) {
                    for (const menu of [...menus.slice(1), ...menus.slice(0, -1).reverse()]) {
                        manager._changeMenu(menu);
                        if (shots && label === 'skim-fast' && round === 0) {
                            await shotRect(`${label}-${shot++}`, [0, 0, 2560, 700]);
                            await sleep(Math.max(0, gap - 40));
                        } else {
                            await sleep(gap);
                        }
                    }
                }
                await sleep(600);
                const frames = this._frames;
                this._frames = null;
                const iv = [];
                for (let i = 1; i < frames.length; i++) iv.push((frames[i][0] - frames[i - 1][0]) / 1000);
                const slow = [];
                for (let i = 1; i < frames.length; i++) {
                    const gapMs = (frames[i][0] - frames[i - 1][0]) / 1000;
                    if (gapMs <= 12.5) continue;
                    const d = {};
                    for (const k of Object.keys(frames[i][2] ?? {})) {
                        const v = ((frames[i][2][k] ?? 0) - (frames[i - 1][2]?.[k] ?? 0)) / 1000;
                        if (v > 0.3) d[k] = Math.round(v * 10) / 10;
                    }
                    slow.push({ at: Math.round((frames[i][0] - start) / 1000), gapMs: Math.round(gapMs), d });
                }
                write('log.jsonl', { label, slow });
                write('log.jsonl', { label, kind: 'skim', first_ms: (frames[0]?.[0] - start) / 1000, iv: iv.map(x => Math.round(x * 100) / 100), cpu: frames.map(f => Math.round(f[1] / 10) / 100), prof: diff(p0, prof()) });
                manager.activeMenu?.close(false);
                await sleep(400);
            }
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'iconfx') {
            qs.open(true);
            await sleep(1500);
            const toggle = qs._grid.get_children().find(c => c.constructor.name === 'DarkModeToggle');
            const box = stageBox(toggle);
            St.Settings.get().slow_down_factor = 10;
            const icon = (function find(a) { if (a instanceof St.Icon) return a; for (const c of a.get_children()) { const f = find(c); if (f) return f; } return null; })(toggle);
            const samples = [];
            toggle.emit('clicked', 1);
            for (let i = 0; i < 40; i++) {
                samples.push(`${icon.scale_x.toFixed(2)}/${icon.opacity}`);
                await sleep(10 * 10);
            }
            write('log.jsonl', { samples: samples.join(' '), pressedProp: Boolean(toggle.constructor.find_property?.('pressed') ?? ('pressed' in toggle)) });
            St.Settings.get().slow_down_factor = 1;
            write('log.jsonl', { checked: toggle.checked, done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'scales') {
            St.Settings.get().slow_down_factor = 10;
            qs.open(true);
            for (let i = 0; i < 6; i++) {
                await sleep(300);
                const pieces = qs._grid.get_children().filter(c => c.visible).slice(0, 4);
                write('log.jsonl', { i, pieces: pieces.map(p => `${p.constructor.name} s${p.scale_x.toFixed(2)}/${p.scale_y.toFixed(2)} pv${p.pivot_point.x.toFixed(2)} op${p.opacity} flags${p._tahoe_glass_opacity_free ? 'O' : ''}${p._tahoe_glass_transform_free ? 'T' : ''}`) });
            }
            St.Settings.get().slow_down_factor = 1;
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'items') {
            const dir = GLib.getenv('TAHOE_TEST_MOTION_DIR');
            const items = await import(`file://${dir}/items.js`);
            for (const [label, menu, target] of [['calendar', date, () => date.box], ['qs', qs, null]]) {
                menu.open(false);
                await sleep(600);
                if (target) {
                    const t = target();
                    const card = { x: 0, y: 0, width: t.width, height: t.height };
                    write('log.jsonl', { label, items: items.cardItems(t, card).map(i => `${i.kind}:${i.actor.constructor.name}.${i.actor.get_style_class_name?.() ?? ''} ${Math.round(i.rect.y)}+${Math.round(i.rect.height)}${i.cells ? ` cells ${i.cells.length} span ${i.span}` : ''}`) });
                } else {
                    for (const piece of qs._grid.get_children().filter(c => c.visible).slice(0, 6))
                        write('log.jsonl', { label: piece.constructor.name, parts: items.pieceItems(piece).map(i => `${i.kind}:${i.actor.constructor.name}.${i.actor.get_style_class_name?.() ?? ''}`) });
                }
                menu.close(false);
                await sleep(300);
            }
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'strip') {
            // stills of the open and close animations, slowed down
            const settings = St.Settings.get();
            const slow = Number(GLib.getenv('TAHOE_TEST_SLOW') ?? 10);
            const cases = [['calendar', date, () => date.box.get_parent()?.get_parent() ?? date.box],
                ['qs', qs, () => qs._boxPointer]];
            const bg = Main.layoutManager._backgroundGroup.get_children().find(a => a._backgroundMenu)?._backgroundMenu;
            if (bg) cases.push(['desktop', bg, () => bg._boxPointer ?? bg.actor]);
            if (GLib.getenv('TAHOE_TEST_STRIP') === 'banner') {
                const notify = () => {
                    // a source goes when its last notification does: a new one each time
                    const source = new MessageTray.Source({ title: 'Glass test', iconName: 'dialog-information-symbolic' });
                    Main.messageTray.add(source);
                    const n = new MessageTray.Notification({ source, title: 'Liquid Glass', body: 'A banner growing out of a glass circle', isTransient: true });
                    source.addNotification(n);
                    return n;
                };
                // one unslowed, to frame the stills
                let n = notify();
                await sleep(800);
                const bin = Main.messageTray._bannerBin;
                write('log.jsonl', { banner: { state: Main.messageTray._notificationState, mapped: bin.mapped, opacity: bin.opacity, y: bin.y, size: bin.get_transformed_size(), pos: bin.get_transformed_position(), banner: Boolean(Main.messageTray._banner), dnd: Main.messageTray._busy ?? null } });
                const box = stageBox(Main.messageTray._bannerBin);
                n.destroy();
                await sleep(800);
                settings.slow_down_factor = slow;
                n = notify();
                for (let i = 0; i < 8; i++) {
                    const b = Main.messageTray._bannerBin;
                    write('log.jsonl', { i, state: Main.messageTray._notificationState, op: b.opacity, y: b.y, banner: Boolean(Main.messageTray._banner), queue: Main.messageTray.queueCount ?? Main.messageTray._notificationQueue?.length });
                    await shotRect(`strip-banner-open-${i}`, box);
                    await sleep(30 * slow);
                }
                // what the banner's timeout does (headless, the user counts as idle, so it never fires)
                Main.messageTray._hideNotification(true);
                for (let i = 0; i < 6; i++) {
                    await shotRect(`strip-banner-close-${i}`, box);
                    await sleep(25 * slow);
                }
                settings.slow_down_factor = 1;
                write('log.jsonl', { done: true });
                return;
            }
            if (GLib.getenv('TAHOE_TEST_STRIP') === 'sub') {
                const want = GLib.getenv('TAHOE_TEST_TOGGLE');
                const toggle = qs._grid.get_children().find(c => c.menu && c.visible && (!want || c.constructor.name === want));
                qs.open(false);
                await sleep(500);
                toggle.menu.open({ animate: false });
                await sleep(500);
                const box = stageBox(qs._boxPointer);
                toggle.menu.close({ animate: false });
                await sleep(400);
                settings.slow_down_factor = slow;
                toggle.menu.open({ animate: true });
                for (let i = 0; i < 8; i++) {
                    await shotRect(`strip-sub-open-${i}`, box);
                    await sleep(30 * slow);
                }
                toggle.menu.close({ animate: true });
                for (let i = 0; i < 6; i++) {
                    await shotRect(`strip-sub-close-${i}`, box);
                    await sleep(25 * slow);
                }
                settings.slow_down_factor = 1;
                write('log.jsonl', { done: true });
                return;
            }
            for (const [label, menu, actor] of cases) {
                // open once unslowed so the layout exists, to frame the stills
                menu.open(false);
                await sleep(500);
                const box = stageBox(actor());
                menu.close(false);
                await sleep(300);
                settings.slow_down_factor = slow;
                const step = Number(GLib.getenv('TAHOE_TEST_STEP') ?? 30);
                menu.open(true);
                for (let i = 0; i < Math.ceil(Number(GLib.getenv("TAHOE_TEST_OPEN_WINDOW") ?? 450) / step); i++) {
                    await shotRect(`strip-${label}-open-${i}`, box);
                    await sleep(step * slow);
                }
                menu.close(true);
                for (let i = 0; i < Math.ceil(300 / step); i++) {
                    await shotRect(`strip-${label}-close-${i}`, box);
                    await sleep(step * slow);
                }
                settings.slow_down_factor = 1;
                await sleep(400);
            }
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'reveal') {
            // Phase 3: the reveal shape on the calendar and on quick settings, at a few stages
            const glass = globalThis.__tahoeGlass;
            write('log.jsonl', { note: `api: ${Boolean(glass)}` });
            try {
                const pm = global.blur_my_shell._pipelines_manager;
                write('log.jsonl', { pipelines: Object.keys(pm.pipelines ?? {}), menus: JSON.stringify(pm.pipelines?.pipeline_glassbar_menus)?.slice(0, 300), popup: global.blur_my_shell._settings?.popup?.PIPELINE });
            } catch (e) { write('log.jsonl', { pm_error: `${e}` }); }
            try {
                const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
                const src = Gio.SettingsSchemaSource.new_from_directory(`${ext.path}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
                const st = new Gio.Settings({ settings_schema: src.lookup('org.gnome.shell.extensions.blur-my-shell', false) });
                write('log.jsonl', { backend: GLib.getenv('GSETTINGS_BACKEND'), cfg: GLib.getenv('XDG_CONFIG_HOME'), version: st.get_int('settings-version'), pipes: st.get_value('pipelines').deepUnpack ? Object.keys(st.get_value('pipelines').deepUnpack()) : null });
            } catch (e) { write('log.jsonl', { gs_error: `${e}` }); }
            for (const [label, menu, actor] of [['calendar', date, () => date.box], ['qs', qs, () => qs._boxPointer]]) {
                menu.open(false);
                await sleep(700);
                const root = glass.root_of(actor());
                const surfaces = glass.surfaces(root);
                write('log.jsonl', { note: `${label}: ${surfaces.length} surfaces` });
                for (const [stage, f] of [['circle', 0], ['mid', 0.5], ['full', 1]]) {
                    for (const s of surfaces) {
                        const w = s.target.width, h = s.target.height;
                        const d = Math.min(w, h, 38);
                        const cx = w / 2, cy = Math.min(h / 2, 19);
                        const rw = d + (w - d) * f, rh = d + (h - d) * f;
                        const x = (cx - d / 2) * (1 - f), y = (cy - d / 2) * (1 - f);
                        const radius = d / 2 + (Math.min(s.corner_radius, Math.min(w, h) / 2) - d / 2) * f;
                        s.set_reveal({ x, y, width: rw, height: rh, radius });
                    }
                    await sleep(200);
                    await shot(`reveal-${label}-${stage}`, actor());
                }
                surfaces.forEach(s => s.set_reveal(null));
                await sleep(200);
                await shot(`reveal-${label}-off`, actor());
                menu.close(false);
                await sleep(300);
            }
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'slide') {
            // sliding across the top bar as the user did: Vitals, then the calendar, and back
            const vitals = Main.panel.statusArea.vitalsMenu?.menu;
            write('log.jsonl', { note: `vitals: ${Boolean(vitals)}` });
            const first = vitals ?? qs;
            for (let i = 0; i < RUNS; i++) {
                first.open(true);
                await sleep(400);
                await this.measure('slide', 'vitals>date', () => { first.close(true); date.open(true); }, OPEN_MS);
                await this.measure('slide', 'date>vitals', () => { date.close(true); first.open(true); }, OPEN_MS);
                first.close(false);
                await sleep(400);
            }
            write('log.jsonl', { done: true });
            return;
        }
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'switch') {
            for (let i = 0; i < RUNS; i++) {
                qs.open(true);
                await sleep(300);
                await this.measure('switch', 'qs>date', () => { qs.close(true); date.open(true); }, OPEN_MS);
                await this.measure('switch', 'date>qs', () => { date.close(true); qs.open(true); }, OPEN_MS);
                qs.close(false);
                await sleep(300);
            }
            write('log.jsonl', { done: true });
            return;
        }
        await this.scenario('quick-settings', qs, () => qs._boxPointer, RUNS);

        const toggle = qs._grid.get_children().find(c => c.menu && c.visible);
        if (toggle) {
            for (let i = 0; i < RUNS; i++) {
                qs.open(false);
                await sleep(400);
                await this.measure(`qs-sub`, 'open', () => toggle.menu.open({ animate: true }), OPEN_MS);
                if (i === RUNS - 1) {
                    try { await shot('qs-sub', qs._boxPointer); } catch (e) { write('log.jsonl', { shot_error: `${e}` }); }
                }
                await this.measure(`qs-sub`, 'close', () => toggle.menu.close({ animate: true }), CLOSE_MS);
                qs.close(false);
                await sleep(300);
            }
        } else {
            write('log.jsonl', { note: 'no quick toggle with a menu' });
        }

        await this.scenario('calendar', date, () => date.box.get_parent() ?? date.actor, RUNS);

        const bg = Main.layoutManager._backgroundGroup.get_children().find(a => a._backgroundMenu)?._backgroundMenu;
        if (bg) {
            await this.scenario('desktop', bg, () => bg.actor, RUNS, async () => {
                bg.sourceActor?.set?.({});
                await sleep(10);
            });
        } else {
            write('log.jsonl', { note: 'no background menu' });
        }
        // sliding across the top bar: one menu closes while the next opens
        for (let i = 0; i < RUNS; i++) {
            qs.open(true);
            await sleep(300);
            await this.measure('switch', 'qs>date', () => { qs.close(true); date.open(true); }, OPEN_MS);
            await this.measure('switch', 'date>qs', () => { date.close(true); qs.open(true); }, OPEN_MS);
            qs.close(false);
            await sleep(300);
        }
        write('log.jsonl', { done: true });
    }

    disable() {
        this._ids?.forEach(id => global.stage.disconnect(id));
    }
}

function St_animations() {
    return St.Settings.get().enable_animations;
}
