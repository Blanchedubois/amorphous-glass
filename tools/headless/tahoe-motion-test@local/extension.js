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
                        p ? Object.fromEntries(Object.entries(p.time).map(([k, v]) => [k, v])) : null]);
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
