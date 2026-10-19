// The Liquid Glass card every widget sits on.
//
// The glass behind a widget is the wallpaper only, so it is a static copy of it, clipped to the
// widget and run through a Blur My Shell pipeline (the same Liquid Glass recipe as the Dock).
// It repaints only when the wallpaper, the mode or the widget's position changes. Without
// Blur My Shell the card falls back to a plain translucent fill.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const BMS_UUID = 'blur-my-shell@aunetx';
const PIPELINE = 'pipeline_glassbar_dock';
export const RADIUS = 24; // Tahoe widget corners, logical px

export const MODES = ['light', 'dark', 'milky'];
const STATE_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass', 'state']);
export {STATE_FILE};

// light | dark | milky, as glass-bar.sh last set it
export function glassMode() {
    try {
        const [, bytes] = GLib.file_get_contents(STATE_FILE);
        const lines = new TextDecoder().decode(bytes).split('\n');
        const mode = lines.filter(l => l.startsWith('mode=')).pop()?.slice(5);
        return MODES.includes(mode) ? mode : 'milky';
    } catch {
        return 'milky';
    }
}

export function bmsUuid() {
    return BMS_UUID;
}

// Blur My Shell's own modules, so the widgets share its pipelines and their live settings
export async function loadBms() {
    const ext = Main.extensionManager.lookup(BMS_UUID);
    if (ext?.state !== ExtensionState.ACTIVE || !global.blur_my_shell)
        return null;
    const base = `file://${ext.path}`;
    const [{Pipeline}, {RoundedPipeline}] = await Promise.all([
        import(`${base}/pipelines/pipeline.js`),
        import(`${base}/render/rounded_pipeline.js`),
    ]);
    return {Pipeline, RoundedPipeline, bms: global.blur_my_shell};
}

export function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export class GlassCard {
    constructor(monitorIndex) {
        this._monitorIndex = monitorIndex;
        this._glass = null;

        this.actor = new St.Widget({
            style_class: 'tahoe-widget',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._backdrop = new Meta.BackgroundGroup({name: 'tahoe-widget-backdrop'});
        this.actor.add_child(this._backdrop);
        // the widget's own content goes here; it carries the rim, drawn over the glass
        this.content = new St.Widget({
            style_class: 'tahoe-widget-content',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true,
        });
        this.actor.add_child(this.content);

        // the wallpaper copy follows the card while it is dragged
        for (const prop of ['x', 'y', 'width', 'height'])
            this.actor.connect(`notify::${prop}`, () => this._syncBackdrop());
    }

    get monitorIndex() {
        return this._monitorIndex;
    }

    set monitorIndex(index) {
        if (index === this._monitorIndex)
            return;
        this._monitorIndex = index;
        this.setGlass(this._lib);
    }

    _syncBackdrop() {
        if (!this._glass)
            return;
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!monitor)
            return;
        // the wallpaper copy covers the whole monitor: show only the part under the card
        const x = Math.round(this.actor.x - monitor.x);
        const y = Math.round(this.actor.y - monitor.y);
        const {background} = this._glass;
        background.set_position(-x, -y);
        background.set_clip(x, y, Math.ceil(this.actor.width), Math.ceil(this.actor.height));
    }

    setGlass(lib) {
        this.clearGlass();
        this._lib = lib;
        if (!lib || !Main.layoutManager.monitors[this._monitorIndex]) {
            this.actor.add_style_class_name('tahoe-widget-fallback');
            return;
        }
        this.actor.remove_style_class_name('tahoe-widget-fallback');
        const {Pipeline, RoundedPipeline, bms} = lib;
        const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, PIPELINE);
        const managers = [];
        const background = pipeline.create_background_with_effects(
            this._monitorIndex, managers, this._backdrop, 'tahoe-widget-glass', false);
        const rounded = new RoundedPipeline(bms._effects_manager, () => RADIUS, () => 0);
        rounded.bind(pipeline, background);
        this._glass = {pipeline, background, managers, rounded};
        this._syncBackdrop();
    }

    clearGlass() {
        if (!this._glass)
            return;
        const {pipeline, background, managers, rounded} = this._glass;
        this._glass = null;
        rounded.destroy();
        managers.forEach(m => m.destroy());
        pipeline.destroy();
        background.destroy();
    }

    setMode(mode) {
        for (const m of MODES)
            this.actor.remove_style_class_name(`tahoe-widget-${m}`);
        this.actor.add_style_class_name(`tahoe-widget-${mode}`);
    }

    destroy() {
        this.clearGlass();
        this._lib = null;
        this.actor.destroy();
    }
}
