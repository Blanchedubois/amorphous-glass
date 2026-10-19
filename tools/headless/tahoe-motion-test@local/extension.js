// Headless test driver (scratch, never installed on the real desktop): opens and closes the glass
// popups of a throwaway headless gnome-shell, logs frame intervals, the time the stage update took,
// Blur My Shell's tahoe_prof counters and JS errors, takes still screenshots once each popup has
// settled, then ends the shell. Output dir: $TAHOE_TEST_OUT.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('TAHOE_TEST_OUT');
const RUNS = Number(GLib.getenv('TAHOE_TEST_RUNS') ?? 5);
const OPEN_MS = 700;
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
        if (GLib.getenv('TAHOE_TEST_ONLY') === 'strip') {
            // stills of the open and close animations, slowed down
            const settings = St.Settings.get();
            const slow = Number(GLib.getenv('TAHOE_TEST_SLOW') ?? 10);
            const cases = [['calendar', date, () => date.box.get_parent()?.get_parent() ?? date.box],
                ['qs', qs, () => qs._boxPointer]];
            const bg = Main.layoutManager._backgroundGroup.get_children().find(a => a._backgroundMenu)?._backgroundMenu;
            if (bg) cases.push(['desktop', bg, () => bg._boxPointer ?? bg.actor]);
            for (const [label, menu, actor] of cases) {
                // open once unslowed so the layout exists, to frame the stills
                menu.open(false);
                await sleep(500);
                const box = stageBox(actor());
                menu.close(false);
                await sleep(300);
                settings.slow_down_factor = slow;
                menu.open(true);
                for (let i = 0; i < 9; i++) {
                    await shotRect(`strip-${label}-open-${i}`, box);
                    await sleep(30 * slow);
                }
                menu.close(true);
                for (let i = 0; i < 6; i++) {
                    await shotRect(`strip-${label}-close-${i}`, box);
                    await sleep(25 * slow);
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
