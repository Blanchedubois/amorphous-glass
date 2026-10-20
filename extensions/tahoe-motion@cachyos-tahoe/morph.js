// The choreography of one popup, on springs (docs/gnome-tahoe/motion-workshop.md and
// motion-implementation.md, Phases B and C).
//
// A card (menu, calendar, banner, submenu, app menu) opens like a drop of liquid glass: a drop
// appears at its origin (the clicked icon, or the pointer) and falls a little way into the card,
// lengthening along its fall and narrowing across it as it speeds up (its volume kept), squashing
// for a moment where it lands. Before it has landed it spreads: its four edges, each on its own
// spring and starting with the drop's own velocity, pour out to the card's edges, the edge leading
// the motion ahead of the one held back at the origin. Its corners stay round and relax to the
// card's radius last. The popup as a whole grows from 0.86 about the origin on an elastic spring,
// overshooting a little and settling with its width and height wobbling out of phase, like a
// liquid coming to rest. The rows rise into place as the edge reaches them, with an eased stagger.
// Closing gathers the card back into the drop and the drop rises into its origin.
//
// A quick settings button is a small drop at its own centre that spreads into its capsule (its
// sides leading), growing and wobbling the same way; the buttons arrive top to bottom with an
// eased stagger, and inside each the parts follow (icon pops, labels slide, a slider's track
// grows).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { cardItems, pieceItems } from './items.js';
import { EXPRESSIVE, LIQUID_MASS, Spring, lerp, smoothstep, speedFor, stagger } from './spring.js';

// the drop: falls this share of the card's height (at most FALL_MAX_PX) and spreads once it has
// covered SPREAD_AT of its fall
const FALL_SHARE = 0.18;
const FALL_MAX_PX = 32;
const SPREAD_AT = 0.4;
// how much the drop lengthens per px/s of its speed, at most MAX_STRETCH
const STRETCH_PER_SPEED = 0.0012;
const MAX_STRETCH = 0.5;
// the drop's edges: the one leading the motion stiffer, the one held at the origin softer
const LEAD = 1.2;
const SIDE = 0.95;
const TRAIL = 0.75;
const EDGE_DAMPING = 0.9;
// the popup's elastic growth about its origin: from ELASTIC_FROM, overshooting about 2 %
const ELASTIC_FROM = 0.92;
const ELASTIC = { damping: 0.6, stiffness: 900 };
// while the popup is past its size, its height gives way to its width (a liquid keeps its volume)
const JELLY = 0.7;
// rows: an eased stagger, `inQuad`, at most ROW_SPREAD_MS for all of them
const ROW_BASE_MS = 24;
const ROW_SPREAD_MS = 120;
const ROW_REVEALED = 0.35;
// and once the glass is this wide (a row never shows outside the glass)
const ROW_WIDE = 0.85;
// closing: the edges gather to the drop, then it rises into its origin
const GATHERED = 0.35;
// quick settings buttons
const BUTTON_ROW_MS = 38;
const BUTTON_ROW_SPREAD_MS = 170;
const BUTTON_COLUMN_MS = 15;
// the blob a button starts as: this share of its height, round
const BUTTON_FROM = 0.55;
const BUTTON_PARTS_AT = 0.35;
// the height a little softer than the width (spatial fast), so the two settle out of step
const BUTTON_HEIGHT = { damping: 0.72, stiffness: 560 };
const BUTTON_PART_MS = 28;
// the glass circle a card starts from: the clicked icon's capsule, or a small one at the pointer
const CIRCLE_MIN_PX = 24;
const CIRCLE_MAX_PX = 48;
const POINTER_CIRCLE_PX = 18;
// one step faster again after the second try on the desktop ("a tiny bit faster"), and closing
// faster still ("the fade out a bit more faster")
const FASTER = 1.15;
const CLOSE_FASTER = 1.5;
// sliding in from another menu, the pour starts this far along (and the elastic from PARTIAL_FROM)
const PARTIAL = 0.55;
const PARTIAL_FROM = 0.97;
const PARTIAL_ROW_MS = 12;
const PARTIAL_ROW_SPREAD_MS = 60;
const PARTIAL_BUTTON_DELAY = 0.3;
// a late hold freezes the glass after this many frames
const LATE_HOLD_FRAMES = 3;
// no animation runs longer than this; one that does is finished and put at rest
const WATCHDOG_MS = 1500;
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

function scaled(token, factor) {
    return { damping: token.damping, stiffness: token.stiffness * factor };
}

/// Four edges (left, right, top, bottom) of a liquid shape, each on its own spring.
class Edges {
    constructor(rect) {
        this.springs = ['x1', 'x2', 'y1', 'y2'].map(() => new Spring(0, EXPRESSIVE.spatial.default));
        this.set(rect);
    }

    /// holds the edges on a rectangle, moving at the given velocities (px/s)
    set(rect, velocity = { x1: 0, x2: 0, y1: 0, y2: 0 }) {
        const [x1, x2, y1, y2] = this.springs;
        [[x1, rect.x, velocity.x1], [x2, rect.x + rect.width, velocity.x2],
            [y1, rect.y, velocity.y1], [y2, rect.y + rect.height, velocity.y2]]
            .forEach(([spring, value, v]) => {
                spring.value = spring.target = value;
                spring.velocity = v;
                spring.settled = true;
            });
    }

    /// pours out to `rect`: each edge from where it is, at its own speed (`factors`)
    retarget(rect, token, factors) {
        const ends = [rect.x, rect.x + rect.width, rect.y, rect.y + rect.height];
        this.springs.forEach((spring, i) => {
            spring.setToken(scaled(token, factors[i]), LIQUID_MASS);
            spring.retarget(ends[i], Math.max(1, Math.abs(ends[i] - spring.value)));
        });
    }

    step(dt) {
        this.springs.forEach(spring => spring.step(dt));
    }

    get settled() {
        return this.springs.every(spring => spring.settled);
    }

    get rect() {
        const [x1, x2, y1, y2] = this.springs.map(spring => spring.value);
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    }

    /// how far from `rect` the edges are, at most, in px
    distance(rect) {
        const ends = [rect.x, rect.x + rect.width, rect.y, rect.y + rect.height];
        return Math.max(...this.springs.map((spring, i) => Math.abs(spring.value - ends[i])));
    }
}

/// edge speed factors [left, right, top, bottom] for a shape pouring in `direction` (+1 down)
function pourFactors(direction) {
    return direction > 0 ? [SIDE, SIDE, TRAIL, LEAD] : [SIDE, SIDE, LEAD, TRAIL];
}

/// A glass card, poured out of a falling drop.
export class CardPiece {
    /// `content`: for an app menu, the window's content actors (they only fade: GTK draws the
    /// rows into one surface); otherwise the rows are found in the glass's target.
    /// `fall`: false for a card that pours straight out of its origin (a submenu out of its toggle)
    constructor(surface, { content = null, geometry = null, fall = true } = {}) {
        this.surface = surface;
        this.target = surface.target;
        this.content = content;
        this.geometry = geometry;
        this.fall = fall;
        this.ready = false;
        this.fresh = true;
        this.targetOpacity = content ? 255 : this.target.opacity || 255;
        this.items = [];
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
        const circleCentre = this.circle.y + this.circle.height / 2;
        this.direction = circleCentre <= this.card.y + this.card.height / 2 ? 1 : -1;
        const fall = this.fall
            ? Math.min(FALL_MAX_PX, this.card.height * FALL_SHARE,
                Math.max(0, this.card.height - this.circle.height) / 2)
            : 0;
        this.originY = circleCentre;
        this.landingY = circleCentre + fall * this.direction;
        // one step faster than M3's size rule (user, after trying it: "a bit too silky")
        this.speed = { fast: 'fast', default: 'fast', slow: 'default' }[speedFor(this.card.width, this.card.height)];
        this.edges = new Edges(this.circle);
        this.drop = new Spring(this.originY, EXPRESSIVE.spatial.fast, { mass: LIQUID_MASS });
        this.radius = new Spring(this.circleRadius, EXPRESSIVE.effects.slow);
        this.spreading = !this.fall;
        if (!this.content) {
            this.target.opacity = this.targetOpacity;
            this.items = cardItems(this.target, this.card, this.speed);
            if (this.target instanceof St.Widget)
                this.target.add_style_class_name(MORPHING_CLASS);
        }
        this.ready = true;
        return true;
    }

    /// a popup already open: a close starts from the whole card
    full() {
        this.edges.set(this.card);
        this.drop.value = this.drop.target = this.landingY;
        this.radius.value = this.radius.target = this.cardRadius;
        this.spreading = true;
        this.items.forEach(item => item.show());
    }

    /// the drop's shape around its falling centre: longer along the fall the faster it goes,
    /// narrower across (its volume kept), squashed where it overshoots its landing point
    dropShape() {
        const d = this.circle.width;
        const cx = this.circle.x + d / 2;
        const cy = this.drop.value;
        let stretch = Math.min(MAX_STRETCH, Math.abs(this.drop.velocity) * STRETCH_PER_SPEED);
        const past = (cy - this.landingY) * this.direction;
        if (past > 0)
            stretch -= Math.min(0.45, past / d * 2.2);
        const along = d * (1 + stretch);
        const across = d / Math.sqrt(Math.max(0.3, 1 + stretch));
        return { x: cx - across / 2, y: cy - along / 2, width: across, height: along };
    }

    begin(opening) {
        this.opening = opening;
        this.lastStart = -Infinity;
        this.rowIndex = 0;
        this.items.forEach(item => item.reset());
        const count = this.items.length;
        const base = count > 1 ? Math.min(ROW_BASE_MS, ROW_SPREAD_MS / (count - 1)) : 0;
        this.rowDelays = this.items.map((_, i) => stagger(i, count, { base }));
        const token = EXPRESSIVE.spatial[this.speed];
        this.edgeToken = { damping: EDGE_DAMPING, stiffness: token.stiffness * FASTER };
        if (opening) {
            if (!this.spreading) {
                this.drop.setToken(EXPRESSIVE.spatial.fast, LIQUID_MASS);
                this.drop.retarget(this.landingY, Math.max(1, Math.abs(this.landingY - this.originY)));
            } else {
                this.spread();
            }
        } else {
            this.items.forEach(item => item.leave());
            this.gathering = true;
            this.rising = false;
            // gather without bouncing: critically damped, quicker than the opening
            this.edges.retarget(this.landingDrop(), { damping: 1, stiffness: token.stiffness * CLOSE_FASTER },
                pourFactors(-this.direction));
            this.radius.setToken(EXPRESSIVE.effects.default);
            this.radius.retarget(this.circleRadius, Math.max(1, this.cardRadius - this.circleRadius));
        }
    }

    /// the drop where it landed (for a submenu, its toggle's capsule)
    landingDrop() {
        const { x, width, height } = this.circle;
        return { x, y: this.landingY - height / 2, width, height };
    }

    /// sliding in from another menu: the drop has already landed and half poured
    partial() {
        if (!this.ready)
            return;
        const rect = {
            x: lerp(this.circle.x, this.card.x, PARTIAL),
            y: lerp(this.circle.y, this.card.y, PARTIAL),
            width: lerp(this.circle.width, this.card.width, PARTIAL),
            height: lerp(this.circle.height, this.card.height, PARTIAL),
        };
        this.edges.set(rect);
        this.drop.value = this.drop.target = this.landingY;
        this.radius.value = lerp(this.circleRadius, this.cardRadius, PARTIAL);
        const count = this.items.length;
        const base = count > 1 ? Math.min(PARTIAL_ROW_MS, PARTIAL_ROW_SPREAD_MS / (count - 1)) : 0;
        this.rowDelays = this.items.map((_, i) => stagger(i, count, { base }));
        this.spread();
    }

    /// the drop pours out into the card, carrying its own velocity into the edges
    spread() {
        this.spreading = true;
        this.edges.retarget(this.card, this.edgeToken, pourFactors(this.direction));
        this.radius.setToken(EXPRESSIVE.effects.slow);
        this.radius.retarget(this.cardRadius, Math.max(1, Math.abs(this.cardRadius - this.radius.value)));
    }

    reveal() {
        const r = this.edges.rect;
        const x1 = Math.max(this.card.x, r.x);
        const y1 = Math.max(this.card.y, r.y);
        const x2 = Math.min(this.card.x + this.card.width, r.x + r.width);
        const y2 = Math.min(this.card.y + this.card.height, r.y + r.height);
        const rect = { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
        // round while it moves: the radius never exceeds the shape's half size
        const radius = Math.min(this.radius.value, rect.width / 2, rect.height / 2);
        this.surface.set_reveal({ ...rect, radius });
        this.lastRect = rect;
        return rect;
    }

    hide() {
        this.surface.set_reveal({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
        this.items.forEach(item => item.apply(0, 0, 1));
        this.content?.forEach(actor => (actor.opacity = 0));
        if (!this.ready && !this.content)
            this.target.opacity = 0;
    }

    /// `u`: ms since this piece began, `dt`: seconds since the last frame; true once settled
    frame(u, dt) {
        return this.opening ? this.openFrame(u, dt) : this.closeFrame(u, dt);
    }

    openFrame(u, dt) {
        if (!this.spreading) {
            this.drop.step(dt);
            const v = this.drop.velocity;
            const shape = this.dropShape();
            this.edges.set(shape, { x1: 0, x2: 0, y1: v, y2: v });
            const travelled = Math.abs(this.drop.value - this.originY) / Math.max(1, Math.abs(this.landingY - this.originY));
            if (travelled >= SPREAD_AT || this.drop.settled)
                this.spread();
        } else {
            this.edges.step(dt);
        }
        this.radius.step(dt);
        const rect = this.reveal();
        let done = this.spreading && this.edges.settled && this.radius.settled;
        this.items.forEach((item, i) => {
            if (!item.started && this.spreading) {
                const top = Math.max(item.rect.y, rect.y);
                const bottom = Math.min(item.rect.y + item.rect.height, rect.y + rect.height);
                const needed = Math.min(item.rect.height * ROW_REVEALED, 10);
                const gap = i > 0 ? this.rowDelays[i] - this.rowDelays[i - 1] : 0;
                const wide = rect.width >= this.card.width * ROW_WIDE;
                if (wide && bottom - top >= needed && u >= this.lastStart + gap) {
                    item.start(u);
                    this.lastStart = u;
                }
            }
            if (!item.step(dt, u, this.direction))
                done = false;
        });
        if (this.content) {
            const opacity = Math.round(255 * smoothstep(0.5, 1, rect.height / this.card.height));
            this.content.forEach(actor => (actor.opacity = opacity));
        }
        return done;
    }

    closeFrame(u, dt) {
        this.items.forEach(item => item.step(dt, u, this.direction));
        if (this.content) {
            const opacity = Math.round(255 * (1 - clamp01(u / 70)));
            this.content.forEach(actor => (actor.opacity = opacity));
        }
        this.radius.step(dt);
        if (!this.rising) {
            this.edges.step(dt);
            if (this.edges.distance(this.landingDrop()) < this.circle.width * GATHERED || this.edges.settled) {
                this.rising = true;
                this.drop.value = this.edges.rect.y + this.edges.rect.height / 2;
                this.drop.velocity = 0;
                this.drop.setToken({ damping: 1, stiffness: EXPRESSIVE.spatial.fast.stiffness * CLOSE_FASTER }, LIQUID_MASS);
                this.drop.retarget(this.originY, Math.max(1, Math.abs(this.originY - this.drop.value)));
            }
        } else {
            this.drop.step(dt);
            const { x, width, height } = this.circle;
            this.edges.set({ x, y: this.drop.value - height / 2, width, height });
        }
        this.reveal();
        return this.rising && this.drop.settled && this.items.every(item => item.settled);
    }

    /// how much of the drop there is, for the popup's fade
    get reach() {
        if (!this.ready)
            return 0;
        if (this.opening)
            return clamp01(Math.abs(this.drop.value - this.originY) / Math.max(1, Math.abs(this.landingY - this.originY)) * 3
                + (this.spreading ? 1 : 0));
        return this.rising
            ? clamp01(Math.abs(this.drop.value - this.originY) / Math.max(1, Math.abs(this.landingY - this.originY)) * 1.5)
            : 1;
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

/// A quick settings button: one liquid body, glass and all. It starts as a round blob at its
/// centre and pours out sideways into its capsule: its width and height on two springs (the
/// width faster), so it widens ahead of growing taller and wobbles a little as the two settle out
/// of step; then its parts arrive one by one.
export class ButtonPiece {
    constructor(surface) {
        this.surface = surface;
        this.target = surface.target;
        this.ready = false;
        this.fresh = true;
        this.items = [];
        // the glass fades with the button (one body): no _tahoe_glass_opacity_free here
        // as it is before anything here touches it (hide() runs before the first layout)
        this.saved = {
            opacity: this.target.opacity || 255,
            pivot: this.target.pivot_point,
            scale_x: this.target.scale_x,
            scale_y: this.target.scale_y,
        };
    }

    layout() {
        if (this.ready || !this.target.has_allocation())
            return this.ready;
        const card = this.surface.glass_rect();
        if (card.width < 2 || card.height < 2)
            return false;
        this.card = card;
        // the blob it starts as: round, a little smaller than the button's height
        const round = Math.min(card.width, card.height) * BUTTON_FROM;
        this.fromX = Math.min(1, round / card.width);
        this.fromY = Math.min(1, round / card.height);
        this.width = new Spring(this.fromX, EXPRESSIVE.spatial.fast, { mass: LIQUID_MASS });
        this.height = new Spring(this.fromY, BUTTON_HEIGHT, { mass: LIQUID_MASS });
        this.fade = new Spring(0, EXPRESSIVE.effects.fast);
        this.items = pieceItems(this.target);
        this.ready = true;
        return true;
    }

    full() {
        this.width.value = this.width.target = 1;
        this.height.value = this.height.target = 1;
        this.fade.value = this.fade.target = 1;
        this.items.forEach(item => item.show());
    }

    /// sliding in from another menu: mostly grown already
    partial() {
        if (!this.ready)
            return;
        this.width.value = lerp(this.fromX, 1, 0.75);
        this.height.value = lerp(this.fromY, 1, 0.75);
        this.fade.value = 0.8;
    }

    begin(opening) {
        this.opening = opening;
        this.partsAt = null;
        this.items.forEach(item => item.reset());
        this.surface.set_reveal(null);
        if (opening) {
            this.width.setToken(EXPRESSIVE.spatial.fast, LIQUID_MASS);
            this.height.setToken(BUTTON_HEIGHT, LIQUID_MASS);
            this.width.retarget(1, 1 - this.fromX || 0.4);
            this.height.retarget(1, 1 - this.fromY || 0.4);
            this.fade.setToken(EXPRESSIVE.effects.fast);
            this.fade.retarget(1, 1);
        } else {
            this.items.forEach(item => item.leave());
            const settle = { damping: 1, stiffness: EXPRESSIVE.spatial.fast.stiffness * CLOSE_FASTER };
            this.width.setToken(settle, LIQUID_MASS);
            this.height.setToken(settle, LIQUID_MASS);
            this.width.retarget(this.fromX, 1 - this.fromX || 0.4);
            this.height.retarget(this.fromY, 1 - this.fromY || 0.4);
            this.fade.setToken(EXPRESSIVE.effects.fast);
            this.fade.retarget(0, 1);
        }
    }

    apply() {
        const target = this.target;
        target.set_pivot_point(0.5, 0.5);
        target.set_scale(Math.max(0.05, this.width.value), Math.max(0.05, this.height.value));
        target.opacity = Math.round(this.saved.opacity * clamp01(this.fade.value));
    }

    hide() {
        this.target.opacity = 0;
    }

    frame(u, dt) {
        this.width.step(dt);
        this.height.step(dt);
        this.fade.step(dt);
        this.apply();
        let done = this.width.settled && this.height.settled && this.fade.settled;
        if (this.opening && this.partsAt === null) {
            const grown = (this.width.value - this.fromX) / Math.max(0.01, 1 - this.fromX);
            if (grown >= BUTTON_PARTS_AT || this.width.settled)
                this.partsAt = u;
        }
        const count = this.items.length;
        this.items.forEach((item, i) => {
            if (this.opening && !item.started && this.partsAt !== null
                && u - this.partsAt >= stagger(i, count, { base: BUTTON_PART_MS, ease: 'linear' }))
                item.start(u);
            if (!item.step(dt, u) && (this.opening || item.started))
                done = false;
        });
        return done;
    }

    get reach() {
        return this.ready ? clamp01(this.fade.value) : 0;
    }

    restore() {
        this.surface.set_reveal(null);
        this.items.forEach(item => item.restore());
        const { opacity, pivot, scale_x, scale_y } = this.saved;
        const target = this.target;
        target.opacity = opacity;
        target.set_pivot_point(pivot.x, pivot.y);
        target.set_scale(scale_x, scale_y);
    }
}

/// The animation of one popup, open or close, on its own frame clock.
export class Morph {
    /// `pieces`: the popup's pieces (taken over from an interrupted animation when it had one);
    /// `quickSettings`: buttons arrive row by row; `lazy`: a function giving pieces whose glass
    /// appears in the first frames (a banner, an app menu); `step(piece)`: called each frame;
    /// `fadeRoot`: fade the popup with the drop; `elastic`: the popup grows about its origin and
    /// settles past its size (one card)
    /// `partial`: sliding in from another menu (GNOME's fade-only open): the pour only partly
    /// plays, starting half poured and fully opaque, the rows close behind each other
    constructor(root, opening, { origin, originKey = null, pieces, quickSettings = false, lazy = null, step = null, fadeRoot = !quickSettings, hold = true, elastic = !quickSettings, partial = false, onDone }) {
        this.root = root;
        this.opening = opening;
        // a function when the popup is not laid out yet: read once it is (see the origin getter)
        this._origin = origin;
        this.originKey = originKey;
        this.quickSettings = quickSettings;
        this.lazy = lazy;
        this.step = step;
        this.fadeRoot = fadeRoot;
        this.onDone = onDone;
        // 'late': after the frames a menu left behind stays up (extension.js, HANDOVER_FRAMES)
        this.held = hold === true ? glassApi()?.hold(root) ?? false : false;
        this.wantHold = hold;
        this.pieces = [];
        this.last = 0;
        this.partial = partial && opening;
        if (elastic)
            this.elastic = this.startElastic(previousScale(root) ?? (this.partial ? PARTIAL_FROM : undefined));
        pieces.forEach(piece => this.add(piece));
        this.order();
        this.render(0);
        this.timeline = new Clutter.Timeline({ actor: root, duration: 60000 });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.start();
    }

    /// the popup grows about its origin (the icon or the pointer) on an elastic spring
    startElastic(from) {
        const root = this.root;
        const saved = { pivot: root.pivot_point, scale_x: 1, scale_y: 1 };
        // closing, the popup is where it is; opening, it may just have been placed (a right-click
        // elsewhere), so the pivot is found once it pours, after its layout
        if (!this.opening)
            this.pivotAtOrigin();
        const spring = new Spring(from ?? (this.opening ? ELASTIC_FROM : 1), ELASTIC, { mass: LIQUID_MASS });
        if (!this.opening) {
            spring.setToken({ damping: 1, stiffness: EXPRESSIVE.spatial.fast.stiffness * CLOSE_FASTER }, LIQUID_MASS);
            spring.retarget(0.94, 0.06);
        }
        return { spring, saved, started: !this.opening };
    }

    /// the stage rectangle the popup opens from, read once its layout has happened (frame two of
    /// an opening): reading it earlier makes Clutter lay the stage out before GNOME has moved
    /// the popup's source
    get origin() {
        if (typeof this._origin === 'function') {
            if (this.opening && (this.frames ?? 0) < 2)
                return null;
            this._origin = this._origin();
        }
        return this._origin;
    }

    /// scales the popup about its origin (the icon or the pointer)
    pivotAtOrigin() {
        const root = this.root;
        if (!this.origin || root.width <= 0 || root.height <= 0)
            return;
        const [sx, sy] = [root.scale_x, root.scale_y];
        root.set_scale(1, 1);
        const [ok, x, y] = root.transform_stage_point(
            this.origin.x + this.origin.width / 2, this.origin.y + this.origin.height / 2);
        if (ok)
            root.set_pivot_point(clamp01(x / root.width), clamp01(y / root.height));
        root.set_scale(sx, sy);
    }

    add(piece) {
        // a popup that was just placed (a right-click elsewhere) is laid out at its new place only
        // in the next frame: a fresh piece is measured then, not from where it was
        if (!(this.opening && piece.fresh))
            this.prepare(piece);
        piece.delay = 0;
        piece.startedAt = undefined;
        this.pieces.push(piece);
    }

    /// lays a piece out (once its popup has a size) and starts it from where it is; a piece
    /// that never animated starts from the drop to open, from the card to close
    prepare(piece) {
        if (!piece.layout(this.origin))
            return false;
        if (piece.fresh && !this.opening)
            piece.full();
        const fresh = piece.fresh;
        piece.fresh = false;
        piece.begin(this.opening);
        if (this.partial && fresh)
            piece.partial();
        return true;
    }

    /// quick settings buttons arrive row by row, top to bottom, on an eased stagger
    order() {
        if (!this.quickSettings || !this.opening)
            return;
        const placed = this.pieces.filter(piece => piece.ready)
            .map(piece => ({ piece, rect: stageRect(piece.target) }))
            .filter(({ rect }) => rect);
        placed.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
        const rows = [];
        for (const entry of placed) {
            const row = rows[rows.length - 1];
            if (row && entry.rect.y <= row.y + 8)
                row.entries.push(entry);
            else
                rows.push({ y: entry.rect.y, entries: [entry] });
        }
        const base = rows.length > 1 ? Math.min(BUTTON_ROW_MS, BUTTON_ROW_SPREAD_MS / (rows.length - 1)) : 0;
        const squeeze = this.partial ? PARTIAL_BUTTON_DELAY : 1;
        rows.forEach((row, r) => row.entries.forEach(({ piece }, c) =>
            (piece.delay = (stagger(r, rows.length, { base }) + c * BUTTON_COLUMN_MS) * squeeze)));
    }

    frame() {
        const now = this.timeline.get_elapsed_time() / slowDown();
        // never left half way, whatever happens: past this, it is at rest
        if (now > WATCHDOG_MS) {
            this.finish();
            return;
        }
        try {
            this.render(now);
        } catch (e) {
            // an error must not leave the glass half poured: put the popup at rest
            console.error(`[tahoe-motion] ${e}\n${e.stack}`);
            this.finish();
        }
    }

    render(now) {
        const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        if (this.lazy && now < LAZY_MS) {
            for (const piece of this.lazy(this.pieces))
                this.add(piece);
            if (this.wantHold === true && !this.held)
                this.held = glassApi()?.hold(this.root) ?? false;
        }
        let done = this.pieces.length > 0 || !this.lazy || now >= LAZY_MS;
        let reach = 0;
        let ordered = false;
        let spreading = false;
        this.frames = (this.frames ?? 0) + 1;
        if (this.wantHold === 'late' && !this.held && this.frames > LATE_HOLD_FRAMES)
            this.held = glassApi()?.hold(this.root) ?? false;
        for (const piece of this.pieces) {
            if (!piece.ready || (piece.fresh && this.opening)) {
                if (this.frames > 1 && this.prepare(piece)) {
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
            if (!piece.frame(u, piece.ran ? dt : 0))
                done = false;
            piece.ran = true;
            reach = Math.max(reach, piece.reach);
            spreading ||= piece.spreading;
            this.step?.(piece);
        }
        if (ordered)
            this.order();
        if (this.fadeRoot)
            this.root.opacity = Math.round(255 * smoothstep(0, 1, reach));
        if (this.elastic) {
            const { spring } = this.elastic;
            if (this.opening && !this.elastic.started && (spreading || this.pieces.length === 0)) {
                this.elastic.started = true;
                this.pivotAtOrigin();
                spring.retarget(1, 1 - spring.value || 0.14);
            }
            spring.step(dt);
            const s = spring.value;
            this.root.set_scale(s, s > 1 ? 1 - (s - 1) * JELLY : s);
            if (!spring.settled || !this.elastic.started)
                done = false;
        }
        if (done && now > 0)
            this.finish();
    }

    /// stops where it is: the pieces keep their springs for the next animation to go on from
    interrupt() {
        this.stopTimeline();
        this.release();
        if (this.elastic)
            this.root._tahoe_elastic = this.elastic.spring.value;
        return this.pieces;
    }

    finish() {
        if (this.finished)
            return;
        this.finished = true;
        this.stopTimeline();
        const restore = () => this.pieces.forEach(piece => {
            try {
                piece.restore();
            } catch (e) {
                console.error(`[tahoe-motion] restore: ${e}`);
            }
        });
        if (this.elastic) {
            this.root.set_scale(1, 1);
            delete this.root._tahoe_elastic;
        }
        if (this.opening) {
            restore();
            if (this.fadeRoot)
                this.root.opacity = 255;
        }
        try {
            this.onDone?.();
        } finally {
            if (!this.opening)
                restore();
            this.release();
        }
    }

    /// the popup as it is at rest (an interrupted close that will not be continued)
    resetRoot() {
        this.root.set_scale(1, 1);
        delete this.root._tahoe_elastic;
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
        if (this.elastic)
            this.root.set_scale(1, 1);
        this.pieces.forEach(piece => piece.restore());
        this.release();
    }
}

/// the scale an interrupted animation left the popup at, if any
function previousScale(root) {
    return root._tahoe_elastic;
}
