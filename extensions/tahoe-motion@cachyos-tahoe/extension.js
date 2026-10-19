// Tahoe Motion: Liquid Glass open and close animations for the shell's glass popups.
//
// A popup opens as a glass circle the size of the clicked icon's capsule, at the edge of the
// popup nearest the icon, growing into the card on a slightly springy curve while its corners
// relax to the card's radius; the content fades in and scales up from 0.96 once the shape is
// about 60 % open. It closes back into the circle, faster and without overshoot. Quick settings
// pieces each grow from a small circle at their own centre, one after the other.
//
// The glass is drawn by the patched Blur My Shell (config/bms-tahoe-glass.patch): this extension
// only drives its reveal shape and freezes its backdrop for the animation, through the
// `globalThis.__tahoeGlass` API. Without that API, with animations off or reduced motion, popups
// open as GNOME opens them. docs/gnome-tahoe/animations.md, Phase 4.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { lerp, smoothstep, springClose, springOpen } from './spring.js';

const OPEN_MS = 260;
const CLOSE_MS = 160;
const STAGGER_MS = 12;
const CIRCLE_PX = 34;
const CIRCLE_MIN_PX = 24;
const CIRCLE_MAX_PX = 48;
const PIECE_CIRCLE = 0.5;
const CONTENT_SCALE = 0.96;
// the content appears over this part of the shape's growth
const CONTENT_FROM = 0.6;
const CONTENT_TO = 1.0;
// the circle itself fades in (and out, on close) over the first part
const CIRCLE_FADE = 0.2;

function glassApi() {
    const api = globalThis.__tahoeGlass;
    return api?.version >= 1 ? api : null;
}

function animationsOn() {
    const settings = St.Settings.get();
    return settings.enable_animations && settings.reducedMotion !== St.ReducedMotion.REDUCE;
}

function slowDown() {
    return St.Settings.get().slow_down_factor || 1;
}

function lerpRect(a, b, t) {
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t),
    };
}

/// the stage rectangle of an actor
function stageRect(actor) {
    if (!actor?.get_stage())
        return null;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    if (![x, y, width, height].every(Number.isFinite))
        return null;
    return { x, y, width, height };
}

/// One glass surface of a popup and its content, animated between the circle and the card.
class Piece {
    constructor(surface, q) {
        this.surface = surface;
        this.target = surface.target;
        this.q = q;
        this.ready = false;
        this.children = null;
        this.target._tahoe_glass_opacity_free = true;
    }

    /// geometry, once the popup is laid out; `origin`: the stage rectangle the circle grows from
    /// (null: the piece's own centre)
    layout(origin, quickSettings) {
        if (this.ready || !this.target.has_allocation())
            return this.ready;
        const card = this.surface.glass_rect();
        if (card.width < 2 || card.height < 2)
            return false;
        let diameter;
        let cx;
        let cy;
        if (!origin || quickSettings) {
            diameter = Math.min(card.width, card.height) * PIECE_CIRCLE;
            cx = card.x + card.width / 2;
            cy = card.y + card.height / 2;
        } else {
            diameter = origin.width > 0 && origin.height > 0
                ? Math.min(Math.max(Math.min(origin.width, origin.height), CIRCLE_MIN_PX), CIRCLE_MAX_PX)
                : CIRCLE_PX;
            diameter = Math.min(diameter, card.width, card.height);
            const [ok, ox, oy] = this.target.transform_stage_point(
                origin.x + origin.width / 2, origin.y + origin.height / 2);
            // under the icon: the point of the card's edge nearest to it
            cx = ok ? ox : card.x + card.width / 2;
            cy = ok ? oy : card.y;
            cx = Math.min(Math.max(cx, card.x + diameter / 2), card.x + card.width - diameter / 2);
            cy = Math.min(Math.max(cy, card.y + diameter / 2), card.y + card.height - diameter / 2);
        }
        this.circle = { x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter };
        this.card = card;
        this.circleRadius = diameter / 2;
        this.cardRadius = Math.min(this.surface.corner_radius, card.width / 2, card.height / 2);
        this.centre = [card.x + card.width / 2, card.y + card.height / 2];
        this.ready = true;
        return true;
    }

    /// `q`: 0 the circle, 1 the card (a little over 1 while the spring overshoots)
    apply(q) {
        this.q = q;
        if (!this.ready) {
            this.surface.set_reveal({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
            this.target.opacity = 0;
            return;
        }
        const shape = Math.min(1, Math.max(0, q));
        const rect = lerpRect(this.circle, this.card, shape);
        this.surface.set_reveal({
            ...rect,
            radius: lerp(this.circleRadius, this.cardRadius, shape),
        });
        this.target.opacity = Math.round(255 * smoothstep(CONTENT_FROM, CONTENT_TO, q));
        const grow = (q - CONTENT_FROM) / (1 - CONTENT_FROM);
        this.scaleContent(lerp(CONTENT_SCALE, 1, Math.max(0, grow)));
    }

    /// scales the content about the card's centre (the glass itself is shaped by the reveal)
    scaleContent(scale) {
        if (!this.children) {
            this.children = this.target.get_children().map(child => ({
                child,
                pivot: child.pivot_point,
                scale_x: child.scale_x,
                scale_y: child.scale_y,
            }));
        }
        const [cx, cy] = this.centre;
        for (const { child } of this.children) {
            if (child.width > 0 && child.height > 0)
                child.set_pivot_point((cx - child.x) / child.width, (cy - child.y) / child.height);
            child.set_scale(scale, scale);
        }
    }

    restore() {
        this.surface.set_reveal(null);
        for (const { child, pivot, scale_x, scale_y } of this.children ?? []) {
            child.set_pivot_point(pivot.x, pivot.y);
            child.set_scale(scale_x, scale_y);
        }
        this.children = null;
        this.target.opacity = 255;
        delete this.target._tahoe_glass_opacity_free;
    }
}

/// The animation of one popup, open or close, on its own frame clock.
class Morph {
    constructor(root, opening, { origin, quickSettings, previous, onDone }) {
        this.pieces = [];
        this.root = root;
        this.opening = opening;
        this.origin = origin;
        this.quickSettings = quickSettings;
        this.onDone = onDone;
        const api = glassApi();
        api.hold(root);
        this.held = true;
        const start = opening ? 0 : 1;
        // an interrupted animation hands over its pieces as they are (shape, content, saved state)
        this.pieces = api.surfaces(root)
            .filter(surface => surface.target.mapped || previous?.has(surface.target))
            .map(surface => {
                const piece = previous?.get(surface.target) ?? new Piece(surface, start);
                previous?.delete(surface.target);
                piece.startedAt = piece.from = piece.delay = undefined;
                return piece;
            });
        previous?.forEach(piece => piece.restore());
        this.duration = (opening ? OPEN_MS : CLOSE_MS) * slowDown();
        this.stagger = opening && quickSettings ? STAGGER_MS * slowDown() : 0;
        // laid out already (a close, or a popup shown before): no empty first frame
        this.pieces.forEach(piece => piece.layout(origin, quickSettings));
        this.order();
        this.pieces.forEach(piece => piece.apply(piece.q));
        const reach = Math.max(0, ...this.pieces.filter(piece => piece.ready).map(piece => piece.q));
        root.opacity = Math.round(255 * smoothstep(0, CIRCLE_FADE, reach));
        this.timeline = new Clutter.Timeline({
            actor: root,
            duration: Math.ceil(this.duration + this.stagger * this.pieces.length) + 1000,
        });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.start();
    }

    frame() {
        const now = this.timeline.get_elapsed_time();
        let done = true;
        let reach = 0;
        this.pieces.forEach(piece => {
            if (!piece.ready && piece.layout(this.origin, this.quickSettings))
                this.order();
            if (!piece.ready) {
                piece.apply(piece.q);
                done = false;
                return;
            }
            piece.startedAt ??= now;
            piece.from ??= piece.q;
            const t = now - piece.startedAt - (piece.delay ?? 0);
            const p = this.opening ? springOpen(t, this.duration) : springClose(t, this.duration);
            piece.apply(lerp(piece.from, this.opening ? 1 : 0, p));
            reach = Math.max(reach, piece.q);
            if (t < this.duration)
                done = false;
        });
        // no hard pop of the first or last circle
        this.root.opacity = Math.round(255 * smoothstep(0, CIRCLE_FADE, reach));
        if (done)
            this.finish();
    }

    /// quick settings pieces arrive one after the other, nearest the clicked icon first
    order() {
        if (!this.stagger)
            return;
        const origin = this.origin;
        const distance = piece => {
            const rect = stageRect(piece.target);
            if (!rect || !origin)
                return 0;
            return Math.hypot(rect.x + rect.width / 2 - (origin.x + origin.width / 2),
                rect.y + rect.height / 2 - (origin.y + origin.height / 2));
        };
        this.pieces.filter(piece => piece.ready && piece.startedAt === undefined)
            .sort((a, b) => distance(a) - distance(b))
            .forEach((piece, index) => (piece.delay = index * this.stagger));
    }

    /// stops where it is: the pieces keep their shape for the next animation to start from
    interrupt() {
        this.stopTimeline();
        this.release();
        return new Map(this.pieces.map(piece => [piece.target, piece]));
    }

    finish() {
        this.stopTimeline();
        if (this.opening) {
            this.pieces.forEach(piece => piece.restore());
            this.root.opacity = 255;
        }
        this.onDone?.();
        if (!this.opening)
            this.pieces.forEach(piece => piece.restore());
        this.release();
    }

    stopTimeline() {
        if (!this.timeline)
            return;
        this.timeline.stop();
        this.timeline.run_dispose();
        this.timeline = null;
    }

    release() {
        if (!this.held)
            return;
        this.held = false;
        glassApi()?.release(this.root);
    }

    destroy() {
        this.stopTimeline();
        this.pieces.forEach(piece => piece.restore());
        this.release();
    }
}

export default class TahoeMotion extends Extension {
    enable() {
        this._morphs = new Map();
        const proto = BoxPointer.BoxPointer.prototype;
        this._boxOpen = proto.open;
        this._boxClose = proto.close;
        const motion = this;
        proto.open = function (animate, onComplete) {
            if (!motion.handles(this, animate))
                return motion._boxOpen.call(this, animate, onComplete);
            return motion.open(this, onComplete);
        };
        proto.close = function (animate, onComplete) {
            if (!this.visible)
                return undefined;
            if (!motion.handles(this, animate))
                return motion._boxClose.call(this, animate, onComplete);
            return motion.close(this, onComplete);
        };
    }

    disable() {
        const proto = BoxPointer.BoxPointer.prototype;
        proto.open = this._boxOpen;
        proto.close = this._boxClose;
        this._morphs.forEach(morph => morph.destroy());
        this._morphs = null;
    }

    handles(boxPointer, animate) {
        const api = glassApi();
        return Boolean(animate) && animationsOn() && api !== null
            && api.surfaces(boxPointer).length > 0;
    }

    isQuickSettings(boxPointer) {
        return boxPointer === Main.panel.statusArea.quickSettings?.menu?._boxPointer;
    }

    takeOver(boxPointer) {
        const running = this._morphs.get(boxPointer);
        this._morphs.delete(boxPointer);
        return running ? running.interrupt() : null;
    }

    open(boxPointer, onComplete) {
        const previous = this.takeOver(boxPointer);
        boxPointer.remove_all_transitions();
        boxPointer.set({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        boxPointer._muteKeys.enabled = false;
        boxPointer.show();
        const morph = new Morph(boxPointer, true, {
            origin: stageRect(boxPointer._sourceActor),
            quickSettings: this.isQuickSettings(boxPointer),
            previous,
            onDone: () => {
                this._morphs.delete(boxPointer);
                boxPointer._muteInput.enabled = false;
                onComplete?.();
            },
        });
        this._morphs.set(boxPointer, morph);
    }

    close(boxPointer, onComplete) {
        const previous = this.takeOver(boxPointer);
        boxPointer._muteInput.enabled = true;
        boxPointer._muteKeys.enabled = true;
        boxPointer.remove_all_transitions();
        const morph = new Morph(boxPointer, false, {
            origin: stageRect(boxPointer._sourceActor),
            quickSettings: this.isQuickSettings(boxPointer),
            previous,
            onDone: () => {
                this._morphs.delete(boxPointer);
                boxPointer.hide();
                boxPointer.opacity = 0;
                boxPointer.translation_x = 0;
                boxPointer.translation_y = 0;
                onComplete?.();
            },
        });
        this._morphs.set(boxPointer, morph);
    }
}
