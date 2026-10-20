// Liquid Glass for the top-right menu (quick settings) while the screen is locked.
//
// On the desktop Blur My Shell gives each quick settings piece its own glass, but its popup
// component is off in the lock screen's session mode. Here each piece gets the same glass: a copy
// of the wallpaper (the lock picture) run through the desktop dropdowns' own Blur My Shell
// pipeline (popup/pipeline, e.g. pipeline_glassbar_menus: refraction, lit rim, edge shadow), rounded
// with its RoundedPipeline to the piece's shape, the way the desktop widgets' GlassCard does it
// (widgets/glass.js). A piece is one visible shape: a toggle pill (with its arrow, when it has a
// menu), a slider, a round button, or an open submenu.
//
// The glass sits in our own layer just below the menu in the shell's UI group, follows the menu's
// open animation, and is undone by the frame on unlock or on any failure. GNOME's menu and its
// toggles are untouched; lockscreen.css (loaded only while locked) clears the pills' own fill.
// A submenu (the Wi-Fi or Power Mode arrow) opens in an overlay of the menu, outside its grid of
// pieces; it gets the same glass at the submenu radius, following it as it grows.
// Without Blur My Shell there is no glass and the pills keep a plain translucent fill.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {loadBms} from './widgets/glass.js';

const CAPSULE = 9999;        // tokens/radius.json: capsule (clamped to half the height)
const SUBMENU_RADIUS = 32;   // tokens/radius.json: submenu

// the visible shapes that get glass, each once
function pieces(box) {
    const out = [];
    const walk = (actor, inside) => {
        const cls = name => actor.has_style_class_name?.(name);
        let radius = 0;
        if (!inside) {
            if (cls('quick-toggle-has-menu') || cls('quick-toggle') || cls('quick-slider') || cls('icon-button'))
                radius = CAPSULE;
            else if (cls('quick-toggle-menu'))
                radius = SUBMENU_RADIUS;
        }
        if (radius)
            out.push({actor, radius});
        // a pill's button and arrow, a slider's icon and a submenu's rows belong to their piece
        for (const child of actor.get_children())
            walk(child, inside || radius > 0);
    };
    walk(box, false);
    return out;
}

// one piece's glass: a wallpaper copy through the popup pipeline, rounded
class PieceGlass {
    constructor(lib, layer, monitorIndex, radius) {
        const {Pipeline, RoundedPipeline, bms} = lib;
        this.monitorIndex = monitorIndex;
        this._radius = radius;
        this._h = 0;
        this.actor = new St.Widget({name: 'menu-glass', reactive: false, clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout()});
        this._backdrop = new Meta.BackgroundGroup({name: 'tahoe-lock-menu-backdrop'});
        this.actor.add_child(this._backdrop);
        layer.add_child(this.actor);
        this._pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, bms._settings.popup.PIPELINE);
        this._managers = [];
        this._background = this._pipeline.create_background_with_effects(
            monitorIndex, this._managers, this._backdrop, 'tahoe-lock-menu-glass', false);
        this._rounded = new RoundedPipeline(bms._effects_manager,
            () => Math.min(this._radius, this._h / 2), () => 0);
        this._rounded.bind(this._pipeline, this._background);
    }

    // x, y: the piece's place on the stage; monitor: the monitor it is on
    place(x, y, w, h, monitor) {
        if (h !== this._h) {
            this._h = h;
            this._rounded.update();   // the rounding reads the radius only when updated
        }
        this.actor.set_position(x, y);
        this.actor.set_size(w, h);
        const mx = x - monitor.x, my = y - monitor.y;
        this._background.set_position(-mx, -my);
        this._background.set_clip(mx, my, w, h);
        this.actor.show();
    }

    destroy() {
        this._rounded.destroy();
        this._managers.forEach(m => m.destroy());
        this._pipeline.destroy();
        this._background.destroy();
        this.actor.destroy();
    }
}

export function buildMenuGlass(frame, dialog) {
    const qs = Main.panel?.statusArea?.quickSettings;
    const menu = qs?.menu;
    const pointer = menu?._boxPointer ?? null;
    if (!menu?.box || !menu.actor)
        return;   // no quick settings in this session mode: nothing to do

    const uiGroup = Main.layoutManager.uiGroup;
    const layer = new St.Widget({name: 'menu-glass-layer', reactive: false, layout_manager: new Clutter.FixedLayout()});
    layer.add_constraint(new Clutter.BindConstraint({source: uiGroup, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(uiGroup, layer);
    const restack = () => {
        if (menu.actor.get_parent() === uiGroup)
            uiGroup.set_child_below_sibling(layer, menu.actor);
    };
    restack();

    let lib = null;
    const glass = new Map();   // piece actor -> PieceGlass
    const watched = new Set();

    const drop = piece => {
        glass.get(piece)?.destroy();
        glass.delete(piece);
    };

    const place = () => {
        layer.opacity = pointer ? pointer.opacity : 255;
        if (!menu.isOpen || !lib) {
            layer.hide();
            return;
        }
        layer.show();
        restack();
        const seen = new Set();
        // the whole menu: the grid of pieces, and the overlay a submenu opens in
        for (const {actor: piece, radius} of pieces(menu.actor)) {
            seen.add(piece);
            if (!watched.has(piece)) {
                watched.add(piece);
                frame.connect(piece, 'notify::allocation', place);
                frame.connect(piece, 'destroy', () => {
                    drop(piece);
                    watched.delete(piece);
                });
            }
            const [x, y] = piece.get_transformed_position();
            const [w, h] = piece.get_transformed_size();
            const shown = piece.mapped && piece.visible && [x, y, w, h].every(Number.isFinite) && w >= 1 && h >= 1;
            if (!shown) {
                glass.get(piece)?.actor.hide();
                continue;
            }
            const cx = x + w / 2, cy = y + h / 2;
            const monitor = Main.layoutManager.monitors.find(m =>
                cx >= m.x && cy >= m.y && cx < m.x + m.width && cy < m.y + m.height) ?? Main.layoutManager.primaryMonitor;
            if (glass.get(piece)?.monitorIndex !== monitor.index) {
                drop(piece);
                glass.set(piece, new PieceGlass(lib, layer, monitor.index, radius));
            }
            glass.get(piece).place(Math.round(x), Math.round(y), Math.round(w), Math.round(h), monitor);
        }
        for (const [piece, g] of glass) {
            if (!seen.has(piece))
                g.actor.hide();
        }
    };

    frame.addUndo(() => {
        for (const g of glass.values())
            g.destroy();
        glass.clear();
        lib = null;
    });
    frame.connect(menu, 'open-state-changed', place);
    frame.connect(menu.box, 'notify::allocation', place);
    if (pointer) {
        for (const prop of ['opacity', 'translation-x', 'translation-y', 'scale-x', 'scale-y'])
            frame.connect(pointer, `notify::${prop}`, place);
    }
    loadBms().then(l => frame.guard(() => {
        if (!layer.get_parent())
            return;   // the dialog went
        lib = l;
        if (!lib)
            frame.addStyleClass(menu.box, 'tahoe-lock-menu-plain');
        place();
    })).catch(e => frame.guard(() => {
        console.warn(`tahoe-lockscreen: no Blur My Shell glass for the top-right menu (${e}); plain fill`);
        frame.addStyleClass(menu.box, 'tahoe-lock-menu-plain');
    }));
}
