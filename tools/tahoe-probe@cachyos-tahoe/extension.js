// Tahoe frame probe v2 (glass-tuning Phase 0, temporary, not shipped).
// For every popup open/close (top bar menus, quick settings and its submenus, dock menus,
// the desktop right-click menu) it records, over a fixed window after the call:
// frame intervals, CPU time per frame update, first-frame latency, and Blur My Shell's
// tahoe_prof counters when present. One JSON line per event in ~/.cache/tahoe-probe.jsonl.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const LOG = GLib.build_filenamev([GLib.get_user_cache_dir(), 'tahoe-probe.jsonl']);
const OPEN_WINDOW_US = 700000;
const CLOSE_WINDOW_US = 450000;

function write(obj) {
    try {
        const f = Gio.File.new_for_path(LOG);
        const s = f.append_to(Gio.FileCreateFlags.NONE, null);
        s.write_all(new TextEncoder().encode(JSON.stringify(obj) + '\n'), null);
        s.close(null);
    } catch (e) {
        console.error(`[tahoe-probe] write: ${e}`);
    }
}

function snapProf() {
    const p = globalThis.__tahoeProf;
    return p ? { time: { ...p.time }, count: { ...p.count } } : null;
}

function bmsPopupSettings() {
    try {
        const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
        const src = Gio.SettingsSchemaSource.new_from_directory(
            GLib.build_filenamev([ext.path, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
        const schema = src.lookup('org.gnome.shell.extensions.blur-my-shell.popup', false);
        const s = new Gio.Settings({ settings_schema: schema });
        const out = { blur: s.get_boolean('blur'), static: s.get_boolean('static-blur'), pipeline: s.get_string('pipeline') };
        if (schema.has_key('quick-settings-freeze'))
            out.freeze = s.get_boolean('quick-settings-freeze');
        return out;
    } catch (e) {
        return { error: String(e) };
    }
}

function countCaptures() {
    let n = 0, mapped = 0;
    const stack = [global.stage];
    while (stack.length) {
        const a = stack.pop();
        for (const e of a.get_effects()) {
            if ((e.constructor.$gtype?.name ?? '') === 'BmsBackdropCaptureEffect') {
                n++;
                if (a.mapped) mapped++;
            }
        }
        stack.push(...a.get_children());
    }
    return { captures: n, mapped };
}

function refreshRate() {
    try {
        return global.stage.peek_stage_views()[0].get_refresh_rate();
    } catch (e) {
        return null;
    }
}

function labelFor(menu) {
    try {
        if (this_isQuickToggleMenu(menu)) {
            const t = menu._header?._headerLabel?.text ?? menu._headerLabel?.text ?? menu.sourceActor?.title;
            return `qs-sub:${t ?? '?'}`;
        }
        if (menu === Main.panel.statusArea.quickSettings?.menu)
            return 'quick-settings';
        for (const [key, ind] of Object.entries(Main.panel.statusArea)) {
            if (ind?.menu === menu)
                return `panel:${key}`;
        }
        const ctor = menu.constructor?.name ?? '?';
        if (ctor === 'BackgroundMenu' || menu.actor?.has_style_class_name?.('background-menu'))
            return 'desktop';
        const src = menu.sourceActor;
        for (let a = src; a; a = a.get_parent()) {
            const n = `${a.name ?? ''} ${a.get_style_class_name?.() ?? ''} ${a.constructor?.name ?? ''}`;
            if (/dash|dock/i.test(n))
                return `dock:${ctor}`;
        }
        return `other:${ctor}:${src?.constructor?.name ?? '?'}`;
    } catch (e) {
        return `error:${e}`;
    }
}

export default class Probe extends Extension {
    enable() {
        this._windows = [];
        this._t0 = 0;
        const prof = globalThis.__tahoeProf;
        if (prof) prof.on = true;
        this._hasUpdate = GObjectSignal(global.stage, 'before-update');
        const [startSig, endSig] = this._hasUpdate ? ['before-update', 'after-update'] : ['before-paint', 'after-paint'];
        this._sigNames = [startSig, endSig];
        this._ids = [
            global.stage.connect(startSig, () => { this._t0 = GLib.get_monotonic_time(); }),
            global.stage.connect(endSig, () => this._onFrame()),
        ];
        this._patched = [];
        const probe = this;
        const patch = (proto, name, kind) => {
            const orig = proto[name];
            if (typeof orig !== 'function') return;
            proto[name] = function (...args) {
                let wasOpen = false;
                try { wasOpen = this.isOpen; } catch (e) {}
                const ret = orig.apply(this, args);
                try {
                    if ((kind === 'open') !== wasOpen)
                        probe._begin(this, kind, args[0]);
                } catch (e) {
                    console.error(`[tahoe-probe] ${e}`);
                }
                return ret;
            };
            this._patched.push([proto, name, orig]);
        };
        patch(PopupMenu.PopupMenu.prototype, 'open', 'open');
        patch(PopupMenu.PopupMenu.prototype, 'close', 'close');
        // GNOME 51 does not export QuickToggleMenu: take its prototype from a live toggle
        this._patchSubmenus = () => {
            if (this._subPatched) return;
            const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
            const menu = grid?.get_children().map(c => c.menu).find(m => m && m !== Main.panel.statusArea.quickSettings.menu);
            if (!menu) return;
            let proto = Object.getPrototypeOf(menu);
            while (proto && !Object.prototype.hasOwnProperty.call(proto, 'open')) proto = Object.getPrototypeOf(proto);
            if (!proto || proto === PopupMenu.PopupMenu.prototype) return;
            submenuProto = proto;
            patch(proto, 'open', 'open');
            patch(proto, 'close', 'close');
            this._subPatched = true;
        };
        this._patchSubmenus();
        write({ probe: 'enabled', at: new Date().toISOString(), signals: this._sigNames, refresh: refreshRate(), bms: bmsPopupSettings(), prof: Boolean(prof) });
    }

    _begin(menu, kind, animate) {
        if (!this._subPatched) this._patchSubmenus();
        const now = GLib.get_monotonic_time();
        this._windows.push({
            label: labelFor(menu), kind, animate: animate === undefined ? null : animate,
            start: now, end: now + (kind === 'open' ? OPEN_WINDOW_US : CLOSE_WINDOW_US),
            frames: [], prof0: snapProf(), surfaces: null,
        });
        const w = this._windows[this._windows.length - 1];
        // glass surfaces while the popup is fully shown (or still closing)
        GLib.timeout_add(GLib.PRIORITY_LOW, kind === 'open' ? 300 : 40, () => {
            try { w.surfaces = countCaptures(); } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _onFrame() {
        if (!this._windows.length) return;
        const t = GLib.get_monotonic_time();
        const cpu = this._t0 ? t - this._t0 : 0;
        for (const w of this._windows)
            if (t <= w.end) w.frames.push([t, cpu]);
        const done = this._windows.filter(w => t > w.end);
        if (done.length) {
            this._windows = this._windows.filter(w => t <= w.end);
            // settle the record off the frame path
            GLib.idle_add(GLib.PRIORITY_LOW, () => { done.forEach(w => this._finish(w)); return GLib.SOURCE_REMOVE; });
        }
    }

    _finish(w) {
        const f = w.frames;
        const intervals = [];
        for (let i = 1; i < f.length; i++) intervals.push((f[i][0] - f[i - 1][0]) / 1000);
        const cpus = f.map(x => x[1] / 1000);
        const hz = refreshRate();
        const period = hz ? 1000 / hz : 8.33;
        // a gap over 150 ms is the shell idling once the popup has settled, not a stutter
        const active = intervals.filter(x => x <= 150);
        const sorted = active.slice().sort((a, b) => a - b);
        const q = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
        const r = x => x === null ? null : Math.round(x * 100) / 100;
        const prof1 = snapProf();
        let prof = null;
        if (w.prof0 && prof1) {
            prof = {};
            for (const k of Object.keys(prof1.count)) {
                const dc = (prof1.count[k] ?? 0) - (w.prof0.count[k] ?? 0);
                const dt = ((prof1.time[k] ?? 0) - (w.prof0.time[k] ?? 0)) / 1000;
                if (dc || dt) prof[k] = dt ? [dc, r(dt)] : [dc];
            }
        }
        write({
            at: new Date().toISOString(), label: w.label, kind: w.kind,
            hz: r(hz), frames: f.length,
            first_frame_ms: f.length ? r((f[0][0] - w.start) / 1000) : null,
            last_frame_ms: f.length ? r((f[f.length - 1][0] - w.start) / 1000) : null,
            interval_ms: { p50: r(q(0.5)), p95: r(q(0.95)), max: r(sorted[sorted.length - 1] ?? null) },
            dropped: active.filter(x => x > period * 1.5).length,
            idle_gaps: intervals.length - active.length,
            raw_ms: intervals.map(x => r(x)), raw_cpu_ms: cpus.map(x => r(x)),
            cpu_ms: { mean: r(cpus.reduce((a, b) => a + b, 0) / Math.max(1, cpus.length)), max: r(Math.max(0, ...cpus)) },
            over_budget: cpus.filter(x => x > period).length,
            ...(w.surfaces ?? {}), bms: bmsPopupSettings(), prof,
        });
    }

    disable() {
        for (const [proto, name, orig] of this._patched ?? []) proto[name] = orig;
        this._patched = [];
        this._subPatched = false;
        submenuProto = null;
        for (const id of this._ids ?? []) global.stage.disconnect(id);
        this._ids = [];
        this._windows = [];
        if (globalThis.__tahoeProf) globalThis.__tahoeProf.on = false;
        write({ probe: 'disabled', at: new Date().toISOString() });
    }
}

let submenuProto = null;
function this_isQuickToggleMenu(menu) {
    return submenuProto !== null && submenuProto.isPrototypeOf(menu);
}

function GObjectSignal(obj, name) {
    try {
        return GObject.signal_lookup(name, obj.constructor.$gtype) !== 0;
    } catch (e) {
        return false;
    }
}
