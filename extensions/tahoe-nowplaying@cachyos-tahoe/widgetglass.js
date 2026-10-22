// The desktop widgets' Liquid Glass, exactly (docs/NOWPLAYING_PLAN.md, "Liquid Glass: the widgets'
// glass"): Blur My Shell's `pipeline_glassbar_dock` (the dock's and the widgets' recipe, in the
// desktop's glass mode: dark here) and Blur My Shell's own RoundedPipeline for the corners, built
// the way the widgets' GlassCard builds them (shared/glass.js). The one difference: the widgets
// copy the wallpaper, this copies the view's backdrop (the swirl over the blurred wallpaper), so the
// glass bends what is really behind it. Without Blur My Shell the CSS stand-in (.tahoe-np-glass)
// stays.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {loadBms} from './shared/glass.js';

const PIPELINE = 'pipeline_glassbar_dock';

let bmsPromise = null;   // Blur My Shell's modules, loaded once

export class WidgetGlass {
    // backdrop: the actor to bend (stage-sized, at 0,0); radius: px, or 'capsule'
    constructor(backdrop, radius) {
        this._backdrop = backdrop;
        this._radius = radius;
        this._glass = null;
        this.destroyed = false;
        // the glass, under whatever the caller puts on top; it follows its own place on screen
        this.actor = new St.Widget({name: 'tahoe-np-widget-glass', reactive: false, x_expand: true, y_expand: true});
        this._copy = new Clutter.Clone({source: backdrop, reactive: false});
        this.actor.add_child(this._copy);
        this.actor.connect('notify::allocation', () => this._place());
        this.actor.connect('destroy', () => this._clear());
        bmsPromise ??= loadBms().catch(() => null);
        bmsPromise.then(lib => {
            if (!this.destroyed && lib)
                this._build(lib);
            this.onReady?.(Boolean(this._glass));
        });
    }

    get hasGlass() {
        return this._glass !== null;
    }

    // the copy lies exactly over the backdrop, wherever this glass is (untransformed: a tilted
    // parent tilts the glass with what it shows)
    _place() {
        let x = 0, y = 0;
        for (let a = this.actor; a && a !== this._backdrop.get_parent(); a = a.get_parent()) {
            x += a.x + a.translation_x;
            y += a.y + a.translation_y;
        }
        x = Math.round(x);
        y = Math.round(y);
        // as the widgets' GlassCard: the copy covers everything, clipped to this glass's box, so
        // Blur My Shell's glass (and its corners) is the box's
        this._copy.set_position(-x, -y);
        this._copy.set_size(this._backdrop.width, this._backdrop.height);
        // the size this glass is given (its allocation): `width` read mid-relayout is its natural
        // size, the whole backdrop copy's, which drew the glass out to the screen's edge
        const box = this.actor.get_allocation_box();
        this._copy.set_clip(x, y, Math.ceil(box.get_width()), Math.ceil(box.get_height()));
    }

    // a parent moved by translation (the layout swap): place the copy again
    place() {
        if (!this.destroyed)
            this._place();
    }

    // the corners (px), changed on the fly (the enter's circle opening into the cover)
    set radius(radius) {
        this._radius = radius;
        try {
            this._glass?.rounded.update();
        } catch {}
    }

    get radius() {
        return this._radius;
    }

    _build({Pipeline, RoundedPipeline, bms}) {
        const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, PIPELINE, this._copy);
        const rounded = new RoundedPipeline(bms._effects_manager,
            () => this._radius === 'capsule' ? Math.round(this.actor.get_allocation_box().get_height() / 2) : this._radius, () => 0);
        rounded.bind(pipeline, this._copy);
        this._glass = {pipeline, rounded};
        this._place();
    }

    _clear() {
        this.destroyed = true;
        const glass = this._glass;
        this._glass = null;
        if (!glass)
            return;
        // Blur My Shell may have torn its side down already (as the widgets' clearGlass handles)
        for (const part of [glass.rounded, glass.pipeline]) {
            try {
                part.destroy();
            } catch {}
        }
    }
}
