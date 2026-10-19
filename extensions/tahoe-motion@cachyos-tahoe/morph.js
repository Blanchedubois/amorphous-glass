// The choreography of one popup (docs/gnome-tahoe/animations.md, Phase 5 tuning).
//
// A card (menu, calendar, banner, submenu, app menu) opens like a drop of glass: a circle pops out
// at its origin (the clicked icon, or the pointer), falls a little way into the card, stretching
// as it falls and squashing as it lands, spreads into a bar, and the bar opens up and down into
// the card, its corners relaxing to the card's radius. The strokes overlap, so the fall's momentum
// carries into the spread, and each is a light spring with a little overshoot (user, 2026-10-19:
// "some inertia", "a bit elastic"). Each row pops in as the growing edge reaches it, one after the
// other. It closes the other way: the rows go first, the card folds into the bar, the bar into the
// circle, which rises back into its origin.
//
// A quick settings button grows from a small circle at its own centre into its capsule; the
// buttons arrive row by row, top to bottom; inside each, the parts follow one by one: the icon
// pops, the labels slide in, a slider's track grows from its start.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { cardItems, pieceItems } from './items.js';
import { lerp, smoothstep, springClose, springOpen } from './spring.js';

// card opening, in ms from the start: the circle falls, spreads into a bar, opens into the card
const FALL_MS = 180;
const FALL_DAMPING = 0.58;
const FALL_SHARE = 0.18;
const FALL_MAX_PX = 40;
// the drop's back edge trails its front by this much, so it lengthens as it pulls away
const TAIL_LAG_MS = 32;
const TAIL_DAMPING = 0.72;
// how much the drop squashes where the spring carries it past its landing point
const SQUASH = 2.5;
const BAR_DELAY_MS = 60;
const BAR_MS = 230;
const BAR_DAMPING = 0.66;
const OPEN_DELAY_MS = 115;
const OPEN_MS = 290;
const OPEN_DAMPING = 0.64;
// rows arrive at least this far apart, all of them by the time the card is open
const ROW_GAP_MS = 22;
// a row arrives once this much of it is inside the glass
const ROW_REVEALED = 0.35;
// card closing: rows out, the card folds into the bar, the bar into the circle, the circle rises
const OUT_MS = 70;
const FOLD_DELAY_MS = 25;
const FOLD_MS = 130;
const UNBAR_DELAY_MS = 90;
const UNBAR_MS = 110;
const RISE_DELAY_MS = 150;
const RISE_MS = 100;
// quick settings buttons
const BUTTON_MS = 260;
const BUTTON_DAMPING = 0.62;
const BUTTON_ROW_MS = 45;
const BUTTON_COLUMN_MS = 15;
const BUTTON_PARTS_AT = 0.3;
const BUTTON_PART_GAP_MS = 35;
const BUTTON_OUT_MS = 60;
const BUTTON_CLOSE_DELAY_MS = 20;
const BUTTON_CLOSE_MS = 150;
const BUTTON_CIRCLE = 0.5;
const BUTTON_FADE = 0.2;
// the glass circle a card starts from: the clicked icon's capsule, or a small one at the pointer
const CIRCLE_MIN_PX = 24;
const CIRCLE_MAX_PX = 48;
const POINTER_CIRCLE_PX = 18;
// the popup fades in and out with the very start of the circle (no hard pop)
const CIRCLE_FADE = 0.2;
// how long a banner's or app menu's animation waits for its glass to appear
const LAZY_MS = 150;
const MORPHING_CLASS = 'tahoe-morphing';

export function glassApi() {
    const api = globalThis.__tahoeGlass;
    return api?.version >= 1 ? api : null;
}

export function animationsOn() {
    const settings = St.Settings.get();
    return settings.enable_animations && settings.reducedMotion !== St.ReducedMotion.REDUCE;
}

function slowDown() {
    return St.Settings.get().slow_down_factor || 1;
}

function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}

/// the stage rectangle of an actor
export function stageRect(actor) {
    if (!actor?.get_stage())
        return null;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    if (![x, y, width, height].every(Number.isFinite))
        return null;
    return { x, y, width, height };
}

/// A glass card: grows from its origin circle as a bar, then drops open; rows pop in.
export class CardPiece {
    /// `content`: for an app menu, the window's content actors (they only fade: GTK draws the
    /// rows into one surface); otherwise the rows are found in the glass's target
    /// `fall`: false for a card that grows straight out of its origin (a submenu out of its
    /// toggle): no fall, the strokes start together
    constructor(surface, { content = null, geometry = null, fall = true } = {}) {
        this.surface = surface;
        this.target = surface.target;
        this.content = content;
        this.geometry = geometry;
        this.fall = fall;
        this.ready = false;
        this.fresh = true;
        // the target's own opacity, as it is before anything here touches it
        this.targetOpacity = content ? 255 : this.target.opacity || 255;
        this.qf = 0;
        this.qt = 0;
        this.qx = 0;
        this.qy = 0;
        this.items = [];
    }

    /// a popup already open: a close starts from the whole card
    full() {
        this.qf = this.qt = this.qx = this.qy = 1;
    }

    layout(origin) {
        if (this.ready || !this.target.has_allocation())
            return this.ready;
        let shape = this.geometry?.(this);
        if (this.geometry && !shape)
            return false;
        if (!shape) {
            const card = this.surface.glass_rect();
            if (card.width < 2 || card.height < 2)
                return false;
            const pointer = !origin || origin.width < 4 || origin.height < 4;
            let diameter = pointer ? POINTER_CIRCLE_PX
                : Math.min(Math.max(Math.min(origin.width, origin.height), CIRCLE_MIN_PX), CIRCLE_MAX_PX);
            diameter = Math.min(diameter, card.width, card.height);
            let cx = card.x + card.width / 2;
            let cy = card.y;
            if (origin) {
                const [ok, ox, oy] = this.target.transform_stage_point(
                    origin.x + origin.width / 2, origin.y + origin.height / 2);
                if (ok) {
                    cx = ox;
                    cy = oy;
                }
            }
            // at the origin, or the point of the card nearest to it
            cx = Math.min(Math.max(cx, card.x + diameter / 2), card.x + card.width - diameter / 2);
            cy = Math.min(Math.max(cy, card.y + diameter / 2), card.y + card.height - diameter / 2);
            shape = {
                card,
                circle: { x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter },
                circleRadius: diameter / 2,
                cardRadius: Math.min(this.surface.corner_radius, card.width / 2, card.height / 2),
            };
        }
        Object.assign(this, shape);
        // the card opens downwards from an origin above its middle, upwards from one below (dock)
        this.direction = this.circle.y + this.circle.height / 2 <= this.card.y + this.card.height / 2 ? 1 : -1;
        // where the falling circle lands: a little way into the card
        const fall = this.fall
            ? Math.min(FALL_MAX_PX, this.card.height * FALL_SHARE,
                Math.max(0, this.card.height - this.circle.height) / 2)
            : 0;
        this.landing = { ...this.circle, y: this.circle.y + fall * this.direction };
        if (!this.content) {
            this.target.opacity = this.targetOpacity;
            this.items = cardItems(this.target, this.card);
            if (this.target instanceof St.Widget)
                this.target.add_style_class_name(MORPHING_CLASS);
        }
        this.ready = true;
        return true;
    }

    reveal() {
        // the drop on its fall: its front leads, its back trails, so it lengthens as it pulls away
        // from its origin and narrows to keep its volume; past its landing point (the spring's
        // overshoot) it squashes, wider and shorter, then settles round
        const d = this.circle.width;
        const front = lerp(this.circle.y, this.landing.y, this.qf);
        const back = lerp(this.circle.y, this.landing.y, this.qt);
        const length = d + Math.abs(front - back);
        const over = Math.max(0, this.qf - 1);
        const squash = 1 + over * SQUASH;
        const height = length / squash;
        const width = d * Math.sqrt(d / length) * squash;
        const cx = this.circle.x + d / 2;
        // a squashed drop keeps its leading edge where it landed
        const dropY = this.direction > 0 ? Math.min(front, back) + (length - height) : Math.min(front, back);
        const drop = { x: cx - width / 2, y: dropY, width, height };
        // the spring's overshoot widens and lengthens the glass a little past the card, clipped
        // by the glass's own bounds: the elastic is in the stroke, the card's edge stays clean
        const qx = Math.max(0, this.qx);
        const qy = Math.max(0, this.qy);
        const left = lerp(drop.x, this.card.x, qx);
        const right = lerp(drop.x + drop.width, this.card.x + this.card.width, qx);
        const top = lerp(drop.y, this.card.y, qy);
        const bottom = lerp(drop.y + drop.height, this.card.y + this.card.height, qy);
        const rect = {
            x: Math.max(this.card.x, left),
            y: Math.max(this.card.y, top),
            width: Math.min(this.card.x + this.card.width, right) - Math.max(this.card.x, left),
            height: Math.min(this.card.y + this.card.height, bottom) - Math.max(this.card.y, top),
        };
        const radius = lerp(Math.min(drop.width, drop.height) / 2, this.cardRadius, clamp01(qy));
        this.surface.set_reveal({ ...rect, radius });
        return rect;
    }

    hide() {
        this.surface.set_reveal({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
        this.items.forEach(item => item.apply(-1));
        this.content?.forEach(actor => (actor.opacity = 0));
        // not laid out yet: its rows are not known, so nothing of it shows
        if (!this.ready && !this.content)
            this.target.opacity = 0;
    }

    begin(opening) {
        this.from = { qf: this.qf, qt: this.qt, qx: this.qx, qy: this.qy };
        this.items.forEach(item => (item.start = null));
        this.lastStart = -Infinity;
        this.opening = opening;
    }

    /// `u`: ms since this piece began; returns true once done
    frame(u) {
        return this.opening ? this.openFrame(u) : this.closeFrame(u);
    }

    openFrame(u) {
        const barDelay = this.fall ? BAR_DELAY_MS : 0;
        const openDelay = this.fall ? OPEN_DELAY_MS : 0;
        this.qf = this.fall ? lerp(this.from.qf, 1, springOpen(u, FALL_MS, FALL_DAMPING)) : 1;
        this.qt = this.fall ? lerp(this.from.qt, 1, springOpen(u - TAIL_LAG_MS, FALL_MS, TAIL_DAMPING)) : 1;
        this.qx = lerp(this.from.qx, 1, springOpen(u - barDelay, BAR_MS, BAR_DAMPING));
        this.qy = lerp(this.from.qy, 1, springOpen(u - openDelay, OPEN_MS, OPEN_DAMPING));
        const rect = this.reveal();
        const end = openDelay + OPEN_MS;
        let done = u >= end;
        for (const item of this.items) {
            if (item.start === null) {
                const top = Math.max(item.rect.y, rect.y);
                const bottom = Math.min(item.rect.y + item.rect.height, rect.y + rect.height);
                const inside = bottom - top;
                const needed = Math.min(item.rect.height * ROW_REVEALED, 10);
                if ((inside >= needed && clamp01(this.qx) > 0.6) || u >= end) {
                    // the rows step in one after the other, all by the time the card is open
                    item.start = Math.min(Math.max(u, this.lastStart + ROW_GAP_MS), Math.max(u, end));
                    this.lastStart = item.start;
                }
            }
            item.apply(item.start === null ? -1 : u - item.start, this.direction);
            if (item.start === null || u < item.start + item.duration)
                done = false;
        }
        if (this.content) {
            const opacity = Math.round(255 * smoothstep(0.5, 1, this.qy));
            this.content.forEach(actor => (actor.opacity = opacity));
        }
        return done;
    }

    closeFrame(u) {
        this.items.forEach(item => item.applyOut(u, OUT_MS));
        if (this.content) {
            const opacity = Math.round(255 * (1 - clamp01(u / OUT_MS)));
            this.content.forEach(actor => (actor.opacity = opacity));
        }
        this.qy = lerp(this.from.qy, 0, springClose(u - FOLD_DELAY_MS, FOLD_MS));
        this.qx = lerp(this.from.qx, 0, springClose(u - UNBAR_DELAY_MS, UNBAR_MS));
        this.qf = this.fall ? lerp(this.from.qf, 0, springClose(u - RISE_DELAY_MS, RISE_MS)) : this.qf;
        // rising back, the back edge (now the top) leads
        this.qt = this.fall ? lerp(this.from.qt, 0, springClose(u - RISE_DELAY_MS + TAIL_LAG_MS, RISE_MS)) : this.qt;
        this.reveal();
        return u >= (this.fall ? RISE_DELAY_MS + RISE_MS : UNBAR_DELAY_MS + UNBAR_MS);
    }

    /// how far the glass has come out of the circle, for the popup's fade
    get reach() {
        return clamp01(Math.max(this.qx, this.qy, this.fall ? this.qf * 0.5 : 0));
    }

    restore() {
        this.surface.set_reveal(null);
        this.items.forEach(item => item.restore());
        this.content?.forEach(actor => (actor.opacity = 255));
        if (!this.content)
            this.target.opacity = this.targetOpacity;
        if (this.target instanceof St.Widget)
            this.target.remove_style_class_name(MORPHING_CLASS);
    }
}

/// A quick settings button: its capsule grows from a small circle at its centre, the whole button
/// (its own fill and edge too) fitting inside; then its parts arrive one by one.
export class ButtonPiece {
    constructor(surface) {
        this.surface = surface;
        this.target = surface.target;
        this.ready = false;
        this.fresh = true;
        this.q = 0;
        this.items = [];
        this.target._tahoe_glass_opacity_free = true;
        // as it is before anything here touches it (hide() runs before the first layout)
        this.saved = {
            opacity: this.target.opacity || 255,
            pivot: this.target.pivot_point,
            scale_x: this.target.scale_x,
            scale_y: this.target.scale_y,
            translation_x: this.target.translation_x,
            translation_y: this.target.translation_y,
        };
    }

    full() {
        this.q = 1;
    }

    layout() {
        if (this.ready || !this.target.has_allocation())
            return this.ready;
        const card = this.surface.glass_rect();
        if (card.width < 2 || card.height < 2)
            return false;
        const diameter = Math.min(card.width, card.height) * BUTTON_CIRCLE;
        const cx = card.x + card.width / 2;
        const cy = card.y + card.height / 2;
        this.card = card;
        this.circle = { x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter };
        this.circleRadius = diameter / 2;
        this.cardRadius = Math.min(this.surface.corner_radius, card.width / 2, card.height / 2);
        this.centre = [cx, cy];
        this.startScale = Math.min(diameter / card.width, diameter / card.height);
        this.items = pieceItems(this.target);
        this.target._tahoe_glass_transform_free = true;
        this.ready = true;
        return true;
    }

    shape(q) {
        const shape = clamp01(q);
        const lerpTo = (a, b) => lerp(a, b, shape);
        const rect = {
            x: lerpTo(this.circle.x, this.card.x),
            y: lerpTo(this.circle.y, this.card.y),
            width: lerpTo(this.circle.width, this.card.width),
            height: lerpTo(this.circle.height, this.card.height),
        };
        this.surface.set_reveal({ ...rect, radius: lerpTo(this.circleRadius, this.cardRadius) });
        // the button itself, fitted inside the glass and centred on it
        const scale = lerpTo(this.startScale, 1);
        const [cx, cy] = this.centre;
        const target = this.target;
        target.set_pivot_point(0, 0);
        target.set_scale(scale, scale);
        target.translation_x = rect.x + rect.width / 2 - scale * cx;
        target.translation_y = rect.y + rect.height / 2 - scale * cy;
        target.opacity = Math.round(255 * smoothstep(0, BUTTON_FADE, q));
    }

    hide() {
        this.surface.set_reveal({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
        this.target.opacity = 0;
    }

    begin(opening) {
        this.from = this.q;
        this.opening = opening;
        this.partsAt = null;
    }

    frame(u) {
        if (!this.opening) {
            this.items.forEach(item => item.applyOut(u, BUTTON_OUT_MS));
            this.q = lerp(this.from, 0, springClose(u - BUTTON_CLOSE_DELAY_MS, BUTTON_CLOSE_MS));
            this.shape(this.q);
            return u >= BUTTON_CLOSE_DELAY_MS + BUTTON_CLOSE_MS;
        }
        this.q = lerp(this.from, 1, springOpen(u, BUTTON_MS, BUTTON_DAMPING));
        this.shape(this.q);
        if (this.partsAt === null && (this.q >= BUTTON_PARTS_AT || u >= BUTTON_MS))
            this.partsAt = u;
        let done = u >= BUTTON_MS;
        this.items.forEach((item, index) => {
            const t = this.partsAt === null ? -1 : u - this.partsAt - index * BUTTON_PART_GAP_MS;
            item.apply(t);
            if (t < item.duration)
                done = false;
        });
        return done;
    }

    get reach() {
        return clamp01(this.q);
    }

    restore() {
        this.surface.set_reveal(null);
        this.items.forEach(item => item.restore());
        {
            const { opacity, pivot, scale_x, scale_y, translation_x, translation_y } = this.saved;
            const target = this.target;
            target.opacity = opacity;
            target.set_pivot_point(pivot.x, pivot.y);
            target.set_scale(scale_x, scale_y);
            target.translation_x = translation_x;
            target.translation_y = translation_y;
        }
        delete this.target._tahoe_glass_opacity_free;
        delete this.target._tahoe_glass_transform_free;
    }
}

/// The animation of one popup, open or close, on its own frame clock.
export class Morph {
    /// `pieces`: the popup's pieces (taken over from an interrupted animation when it had one);
    /// `quickSettings`: buttons arrive row by row; `lazy`: a function giving pieces whose glass
    /// appears in the first frames (a banner, an app menu); `step(piece)`: called each frame;
    /// `fadeRoot`: fade the popup with the circle
    constructor(root, opening, { origin, pieces, quickSettings = false, lazy = null, step = null, fadeRoot = true, hold = true, onDone }) {
        this.root = root;
        this.opening = opening;
        this.origin = origin;
        this.quickSettings = quickSettings;
        this.lazy = lazy;
        this.step = step;
        this.fadeRoot = fadeRoot;
        this.onDone = onDone;
        this.held = hold ? glassApi()?.hold(root) ?? false : false;
        this.wantHold = hold;
        this.pieces = [];
        pieces.forEach(piece => this.add(piece));
        this.order();
        this.render(0);
        this.timeline = new Clutter.Timeline({ actor: root, duration: 60000 });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.start();
    }

    add(piece) {
        this.prepare(piece);
        piece.delay = 0;
        piece.startedAt = undefined;
        this.pieces.push(piece);
    }

    /// lays a piece out (once its popup has a size) and starts it from where it is; a piece
    /// that never animated starts from the circle to open, from the card to close
    prepare(piece) {
        if (!piece.layout(this.origin))
            return false;
        if (piece.fresh && !this.opening)
            piece.full();
        piece.fresh = false;
        piece.begin(this.opening);
        return true;
    }

    /// quick settings buttons arrive row by row, top to bottom
    order() {
        if (!this.quickSettings || !this.opening)
            return;
        const placed = this.pieces.filter(piece => piece.ready)
            .map(piece => ({ piece, rect: stageRect(piece.target) }))
            .filter(({ rect }) => rect);
        placed.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
        let row = -1;
        let rowY = -Infinity;
        let column = 0;
        for (const { piece, rect } of placed) {
            if (rect.y > rowY + 8) {
                row++;
                rowY = rect.y;
                column = 0;
            }
            piece.delay = row * BUTTON_ROW_MS + column++ * BUTTON_COLUMN_MS;
        }
    }

    frame() {
        this.render(this.timeline.get_elapsed_time() / slowDown());
    }

    render(now) {
        if (this.lazy && now < LAZY_MS) {
            for (const piece of this.lazy(this.pieces))
                this.add(piece);
            if (this.wantHold && !this.held)
                this.held = glassApi()?.hold(this.root) ?? false;
        }
        let done = this.pieces.length > 0 || !this.lazy || now >= LAZY_MS;
        let reach = 0;
        let ordered = false;
        for (const piece of this.pieces) {
            if (!piece.ready) {
                if (this.prepare(piece)) {
                    ordered = true;
                } else {
                    piece.hide();
                    this.step?.(piece);
                    done = false;
                    continue;
                }
            }
            piece.startedAt ??= now;
            const u = now - piece.startedAt - piece.delay;
            if (u < 0) {
                piece.hide();
                done = false;
                continue;
            }
            if (!piece.frame(u))
                done = false;
            reach = Math.max(reach, piece.reach);
            this.step?.(piece);
        }
        if (ordered)
            this.order();
        if (this.fadeRoot)
            this.root.opacity = Math.round(255 * smoothstep(0, CIRCLE_FADE, reach));
        if (done && now > 0)
            this.finish();
    }

    /// stops where it is: the pieces keep their shape for the next animation to start from
    interrupt() {
        this.stopTimeline();
        this.release();
        return this.pieces;
    }

    finish() {
        this.stopTimeline();
        if (this.opening) {
            this.pieces.forEach(piece => piece.restore());
            if (this.fadeRoot)
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
