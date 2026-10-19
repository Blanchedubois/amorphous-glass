// The parts of a popup that arrive one after the other: the rows and blocks of a menu or card,
// and the inner parts of a quick settings button (icon, label, slider track).
import St from 'gi://St';

import { lerp, springOpen } from './spring.js';

// a block taller than this share of the card is split into what is inside it
const SPLIT_SHARE = 0.4;
// a block whose children sit in a grid (a calendar's days) arrives whole
function isGrid(kids) {
    const rows = new Set(kids.map(kid => Math.round(kid.y)));
    return kids.length > 6 && rows.size <= kids.length / 2;
}
const MAX_ITEMS = 40;

function shown(actor) {
    return actor.visible && actor.width > 1 && actor.height > 1;
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

/// a few cards stacked one above the other (the calendar's events, world clocks and weather)
function isStack(parent, kids) {
    if (kids.length < 2 || kids.length > 6 || parent.height < 100)
        return false;
    const rows = new Set(kids.map(kid => Math.round(kid.y)));
    return rows.size === kids.length && kids.every(kid => kid.height >= 24);
}

/// The rows of a card, top to bottom: blocks are split while they are tall and few-childed.
export function cardItems(target, card) {
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
                items.push(new Item(child, rectIn(child, target), 'drop'));
            else if (isGrid(kids))
                // a grid (the calendar's days) arrives as a card of its own: a wave across it
                items.push(new GridItem(child, rectIn(child, target), kids));
            else if (tall || kids.length === 1 || isStack(child, kids))
                queue.push(child);
            else
                items.push(new Item(child, rectIn(child, target), 'drop'));
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

const ITEM_MS = {
    drop: 170,
    cell: 160,
    pop: 220,
    slide: 220,
    grow: 260,
};

/// One part arriving: from hidden to its place, on a small spring of its own.
export class Item {
    constructor(actor, rect, kind) {
        this.actor = actor;
        this.rect = rect;
        this.kind = kind;
        this.start = null;
        this.saved = {
            opacity: actor.opacity,
            pivot: actor.pivot_point,
            scale_x: actor.scale_x,
            scale_y: actor.scale_y,
            translation_x: actor.translation_x,
            translation_y: actor.translation_y,
        };
    }

    get duration() {
        return ITEM_MS[this.kind];
    }

    /// `t`: ms since this item started (negative: not yet); `direction`: +1 when the card grows
    /// downwards (the rows drop in from a little above), -1 upwards
    apply(t, direction = 1, timing = this.kind) {
        const actor = this.actor;
        if (t < 0) {
            actor.opacity = 0;
            return;
        }
        const duration = ITEM_MS[timing];
        const p = springOpen(t, duration, this.kind === 'grow' ? 0.8 : 0.55);
        const fade = Math.min(1, t / (duration * 0.45));
        actor.opacity = Math.round(this.saved.opacity * fade);
        switch (this.kind) {
        case 'drop':
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(lerp(0.9, 1, p), lerp(0.9, 1, p));
            actor.translation_y = this.saved.translation_y + lerp(-9 * direction, 0, p);
            break;
        case 'pop':
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(lerp(0.35, 1, p), lerp(0.35, 1, p));
            break;
        case 'slide':
            actor.translation_x = this.saved.translation_x + lerp(-12, 0, p);
            break;
        case 'grow':
            actor.set_pivot_point(0, 0.5);
            actor.set_scale(Math.max(0, p), 1);
            break;
        }
    }

    /// leaving: all together, quickly (`t` ms since the close began)
    applyOut(t, duration) {
        const p = Math.min(1, Math.max(0, t / duration));
        this.actor.opacity = Math.round(this.saved.opacity * (1 - p));
        if (this.kind === 'drop' || this.kind === 'pop') {
            this.actor.set_pivot_point(0.5, 0.5);
            this.actor.set_scale(lerp(1, 0.94, p), lerp(1, 0.94, p));
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

// a grid's wave: each row of cells this far after the one above, each cell after the one left
const GRID_ROW_MS = 30;
const GRID_COLUMN_MS = 8;
// the whole wave, however many cells, within this
const GRID_SPAN_MS = 150;

/// A grid that arrives as a card of its own: its cells pop in as a diagonal wave, row by row.
export class GridItem {
    constructor(actor, rect, cells) {
        this.actor = actor;
        this.rect = rect;
        this.kind = 'grid';
        this.start = null;
        const rows = [...new Set(cells.map(cell => Math.round(cell.y)))].sort((a, b) => a - b);
        const columns = [...new Set(cells.map(cell => Math.round(cell.x)))].sort((a, b) => a - b);
        this.cells = cells.map(cell => {
            const item = new Item(cell, { x: cell.x, y: cell.y, width: cell.width, height: cell.height }, 'pop');
            item.delay = rows.indexOf(Math.round(cell.y)) * GRID_ROW_MS
                + columns.indexOf(Math.round(cell.x)) * GRID_COLUMN_MS;
            return item;
        });
        const span = Math.max(0, ...this.cells.map(cell => cell.delay));
        const squeeze = span > GRID_SPAN_MS ? GRID_SPAN_MS / span : 1;
        this.cells.forEach(cell => (cell.delay *= squeeze));
        this.span = span * squeeze;
    }

    get duration() {
        return this.span + ITEM_MS.cell;
    }

    apply(t) {
        for (const cell of this.cells)
            cell.apply(t < 0 ? -1 : t - cell.delay, 1, 'cell');
    }

    applyOut(t, duration) {
        this.cells.forEach(cell => cell.applyOut(t, duration));
    }

    restore() {
        this.cells.forEach(cell => cell.restore());
    }
}
