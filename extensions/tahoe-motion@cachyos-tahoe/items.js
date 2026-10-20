// The parts of a popup that arrive one after the other: the rows and blocks of a menu or card,
// and the inner parts of a quick settings button (icon, label, slider track). Each moves on its
// own springs (spring.js): its place and size on a spatial spring, which overshoots a little, its
// fade on an effects spring, which never does (docs/gnome-tahoe/motion-workshop.md).
import St from 'gi://St';

import { EXPRESSIVE, LIQUID_MASS, Spring, lerp } from './spring.js';

// a block taller than this share of the card is split into what is inside it
const SPLIT_SHARE = 0.4;
const MAX_ITEMS = 40;

function shown(actor) {
    return actor.visible && actor.width > 1 && actor.height > 1;
}

/// a block whose children sit in a grid (a calendar's days) arrives whole
function isGrid(kids) {
    const rows = new Set(kids.map(kid => Math.round(kid.y)));
    return kids.length > 6 && rows.size <= kids.length / 2;
}

/// a few cards stacked one above the other (the calendar's events, world clocks and weather)
function isStack(parent, kids) {
    if (kids.length < 2 || kids.length > 6 || parent.height < 100)
        return false;
    const rows = new Set(kids.map(kid => Math.round(kid.y)));
    return rows.size === kids.length && kids.every(kid => kid.height >= 24);
}

/// where an actor sits in `ancestor`'s coordinates
function rectIn(actor, ancestor) {
    let x = 0;
    let y = 0;
    for (let a = actor; a && a !== ancestor; a = a.get_parent()) {
        x += a.x;
        y += a.y;
    }
    return { x, y, width: actor.width, height: actor.height };
}

/// The rows of a card, top to bottom: blocks are split while they are tall and few-childed.
export function cardItems(target, card, speed) {
    const items = [];
    const queue = [target];
    while (queue.length && items.length < MAX_ITEMS) {
        const parent = queue.shift();
        for (const child of parent.get_children()) {
            if (!shown(child))
                continue;
            const kids = child.get_children().filter(shown);
            const tall = child.height > card.height * SPLIT_SHARE;
            // a button paints its own background: it arrives whole, not just its label
            if (child instanceof St.Button || kids.length === 0)
                items.push(new Item(child, rectIn(child, target), 'row', speed));
            else if (isGrid(kids))
                // a grid (the calendar's days) arrives as a card of its own: a wave across it
                items.push(new GridItem(child, rectIn(child, target), kids));
            else if (tall || kids.length === 1 || isStack(child, kids))
                queue.push(child);
            else
                items.push(new Item(child, rectIn(child, target), 'row', speed));
        }
    }
    return items.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/// The parts of a quick settings button, left to right: its icon pops, its labels slide in, a
/// slider's track grows from its start.
export function pieceItems(target) {
    const items = [];
    const width = target.width;
    const visit = actor => {
        for (const child of actor.get_children()) {
            if (!shown(child))
                continue;
            const kids = child.get_children().filter(shown);
            const isText = child instanceof St.Label || kids.some(kid => kid instanceof St.Label);
            if (kids.length > 0 && !(child instanceof St.Icon) && !isText
                && (kids.length === 1 || child.width > width * 0.6)) {
                visit(child);
                continue;
            }
            const kind = child.width > width * 0.45 && !isText ? 'grow'
                : isText ? 'slide' : 'pop';
            items.push(new Item(child, rectIn(child, target), kind));
        }
    };
    visit(target);
    return items.sort((a, b) => a.rect.x - b.rect.x);
}

// how far a row rises into place, and how small it starts
const ROW_RISE_PX = 16;
const ROW_SCALE = 0.85;
const POP_SCALE = 0.4;
const CELL_SCALE = 0.55;
const SLIDE_PX = 16;

/// the springs of each kind of part: [place and size, fade]
function tokens(kind, speed) {
    switch (kind) {
    case 'row':
        return [EXPRESSIVE.spatial[speed === 'default' ? 'default' : 'fast'], EXPRESSIVE.effects.fast];
    case 'pop':
    case 'cell':
        return [EXPRESSIVE.spatial.fast, EXPRESSIVE.effects.fast];
    case 'grow':
        return [{ ...EXPRESSIVE.spatial.default, damping: 0.9 }, EXPRESSIVE.effects.fast];
    default:
        return [EXPRESSIVE.spatial.default, EXPRESSIVE.effects.default];
    }
}

/// One part arriving: from hidden to its place on its springs.
export class Item {
    constructor(actor, rect, kind, speed = 'default') {
        this.actor = actor;
        this.rect = rect;
        this.kind = kind;
        this.speed = speed;
        this.started = false;
        const [place, fade] = tokens(kind, speed);
        this.place = new Spring(0, place, { mass: LIQUID_MASS });
        this.fade = new Spring(0, fade);
        this.saved = {
            opacity: actor.opacity || 255,
            pivot: actor.pivot_point,
            scale_x: actor.scale_x,
            scale_y: actor.scale_y,
            translation_x: actor.translation_x,
            translation_y: actor.translation_y,
        };
    }

    /// the item comes in from where it is (hidden, or half gone after an interrupted close)
    start() {
        this.started = true;
        const [place, fade] = tokens(this.kind, this.speed);
        this.place.setToken(place, LIQUID_MASS);
        this.fade.setToken(fade);
        this.place.retarget(1, 1);
        this.fade.retarget(1, 1);
    }

    /// leaving: it fades (and only fades: the glass carries it away)
    leave() {
        this.started = true;
        this.fade.setToken(EXPRESSIVE.effects.fast);
        this.fade.retarget(0, 1);
    }

    /// a new open or close: the item waits to be started again, as it is
    reset() {
        this.started = false;
    }

    /// shown in place (a popup already open, about to close)
    show() {
        this.place.value = this.place.target = 1;
        this.fade.value = this.fade.target = 1;
    }

    get settled() {
        return this.started && this.place.settled !== false && this.fade.settled !== false;
    }

    /// `direction`: +1 when the card grows downwards (rows rise from below), -1 upwards
    step(dt, _now, direction = 1) {
        if (this.started) {
            this.place.step(dt);
            this.fade.step(dt);
        }
        this.apply(this.place.value, this.fade.value, direction);
        return this.settled;
    }

    apply(p, fade, direction) {
        const actor = this.actor;
        actor.opacity = Math.round(this.saved.opacity * Math.min(1, Math.max(0, fade)));
        switch (this.kind) {
        case 'row': {
            const scale = lerp(ROW_SCALE, 1, p);
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(scale, scale);
            actor.translation_y = this.saved.translation_y + (1 - p) * ROW_RISE_PX * direction;
            break;
        }
        case 'pop':
        case 'cell': {
            const scale = lerp(this.kind === 'pop' ? POP_SCALE : CELL_SCALE, 1, p);
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(scale, scale);
            break;
        }
        case 'slide':
            actor.translation_x = this.saved.translation_x - (1 - p) * SLIDE_PX;
            break;
        case 'grow':
            actor.set_pivot_point(0, 0.5);
            actor.set_scale(Math.max(0, p), 1);
            break;
        }
    }

    restore() {
        const { opacity, pivot, scale_x, scale_y, translation_x, translation_y } = this.saved;
        const actor = this.actor;
        actor.opacity = opacity;
        actor.set_pivot_point(pivot.x, pivot.y);
        actor.set_scale(scale_x, scale_y);
        actor.translation_x = translation_x;
        actor.translation_y = translation_y;
    }
}

// a grid's wave: each row of cells this far after the one above, each cell after the one left,
// the whole wave within GRID_SPAN_MS
const GRID_ROW_MS = 30;
const GRID_COLUMN_MS = 8;
const GRID_SPAN_MS = 160;

/// A grid that arrives as a card of its own: its cells pop in as a diagonal wave, row by row.
export class GridItem {
    constructor(actor, rect, cells) {
        this.actor = actor;
        this.rect = rect;
        this.kind = 'grid';
        this.started = false;
        const rows = [...new Set(cells.map(cell => Math.round(cell.y)))].sort((a, b) => a - b);
        const columns = [...new Set(cells.map(cell => Math.round(cell.x)))].sort((a, b) => a - b);
        this.cells = cells.map(cell => {
            const item = new Item(cell, { x: cell.x, y: cell.y, width: cell.width, height: cell.height }, 'cell');
            item.delay = rows.indexOf(Math.round(cell.y)) * GRID_ROW_MS
                + columns.indexOf(Math.round(cell.x)) * GRID_COLUMN_MS;
            return item;
        });
        const span = Math.max(0, ...this.cells.map(cell => cell.delay));
        const squeeze = span > GRID_SPAN_MS ? GRID_SPAN_MS / span : 1;
        this.cells.forEach(cell => (cell.delay *= squeeze));
    }

    start(now) {
        this.started = true;
        this.startedAt = now;
        this.leaving = false;
    }

    leave() {
        this.started = true;
        this.leaving = true;
        this.cells.forEach(cell => cell.leave());
    }

    reset() {
        this.started = false;
        this.cells.forEach(cell => cell.reset());
    }

    get settled() {
        return this.started && this.cells.every(cell => cell.settled);
    }

    step(dt, now) {
        for (const cell of this.cells) {
            if (this.started && !this.leaving && !cell.started && now - this.startedAt >= cell.delay)
                cell.start();
            cell.step(dt, now);
        }
        return this.settled;
    }

    apply(p, fade, direction) {
        this.cells.forEach(cell => cell.apply(p, fade, direction));
    }

    show() {
        this.cells.forEach(cell => cell.show());
    }

    restore() {
        this.cells.forEach(cell => cell.restore());
    }
}
