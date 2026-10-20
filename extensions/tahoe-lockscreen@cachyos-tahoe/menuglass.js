// Liquid Glass for the top-right menu (quick settings) while the screen is locked.
//
// On the desktop Blur My Shell gives each quick settings piece its own glass, but its popup glass
// is off in the lock screen's session mode. Here each piece (the toggle pills, sliders, round
// buttons, an open submenu) gets glass of its own, as on the desktop: a clone of GNOME's lock
// picture under it, slightly softened, a little white over it, rounded to the piece, with the
// 1 px edge line. The glass sits in our own layer just below the menu in the shell's UI group,
// follows the menu's open and close animation, and is undone by the frame on unlock or on any
// failure. GNOME's menu, its toggles and what they do are untouched; lockscreen.css (loaded only
// while locked) clears the pills' own fill so the glass shows.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SUBMENU_RADIUS = 32;   // tokens/radius.json: submenu
const BLUR = 3;              // logical px of softening
const MILK = 0.10;           // white over the glass (the lock screen is always white on the picture)
const EDGE = 0.16;           // the 1 px edge line (tokens/glass.json, dark)

const DECLARATIONS = `
uniform float g_w;
uniform float g_h;
uniform float g_radius;
uniform float g_blur;
uniform float g_milk;
uniform float g_edge;
`;
const SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 b = vec2(g_blur / g_w, g_blur / g_h);
    vec4 s = texture2D(cogl_sampler0, uv) * 0.2;
    s += texture2D(cogl_sampler0, uv + vec2(b.x, 0.0)) * 0.1;
    s += texture2D(cogl_sampler0, uv - vec2(b.x, 0.0)) * 0.1;
    s += texture2D(cogl_sampler0, uv + vec2(0.0, b.y)) * 0.1;
    s += texture2D(cogl_sampler0, uv - vec2(0.0, b.y)) * 0.1;
    s += texture2D(cogl_sampler0, uv + b) * 0.1;
    s += texture2D(cogl_sampler0, uv - b) * 0.1;
    s += texture2D(cogl_sampler0, uv + vec2(b.x, -b.y)) * 0.1;
    s += texture2D(cogl_sampler0, uv + vec2(-b.x, b.y)) * 0.1;
    vec3 c = s.a > 0.004 ? s.rgb / s.a : vec3(0.0);
    c = mix(c, vec3(1.0), g_milk);
    vec2 size = vec2(g_w, g_h);
    vec2 q = abs(uv * size - 0.5 * size) - (0.5 * size - g_radius);
    float inside = g_radius - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
    float a = clamp(inside + 0.5, 0.0, 1.0);
    // the edge line, a little brighter along the top as if lit from above
    float lit = 1.0 + 0.6 * (1.0 - uv.y);
    c = mix(c, vec3(1.0), g_edge * lit * (1.0 - smoothstep(0.5, 1.5, inside)));
    cogl_color_out = vec4(c * a, a) * cogl_color_in.a;
`;

const PieceGlassEffect = GObject.registerClass(
class TahoeLockPieceGlassEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
        this.radius = 0;
        this.paints = 0;
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeLockPiece) {
            pipeline.add_snippet(this._snippet);
            pipeline._tahoeLockPiece = true;
        }
        const actor = this.get_actor();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const w = Math.max(1, actor.width * scale), h = Math.max(1, actor.height * scale);
        const set = (n, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(n), v);
        set('g_w', w);
        set('g_h', h);
        set('g_radius', Math.min(this.radius * scale, w / 2, h / 2));
        set('g_blur', BLUR * scale);
        set('g_milk', MILK);
        set('g_edge', EDGE);
        super.vfunc_paint_target(node, paintContext);
        this.paints++;
    }
});

// the pieces that get glass: top-level toggles, sliders and round buttons, and open submenus
function pieces(box) {
    const out = [];
    const walk = (actor, insidePiece) => {
        const cls = name => actor.has_style_class_name?.(name);
        let piece = null;
        if (!insidePiece) {
            if (cls('quick-toggle') || cls('quick-slider'))
                piece = {actor, radius: 9999};
            else if (cls('icon-button'))
                piece = {actor, radius: 9999};
            else if (cls('quick-toggle-menu'))
                piece = {actor, radius: SUBMENU_RADIUS};
        }
        if (piece)
            out.push(piece);
        // a submenu's own rows are not pieces of their own; a toggle's arrow is part of the pill
        const deeper = insidePiece || (piece && piece.radius !== SUBMENU_RADIUS) || cls('quick-toggle-menu');
        for (const child of actor.get_children())
            walk(child, deeper);
    };
    walk(box, false);
    return out;
}

export function buildMenuGlass(frame, dialog, backgroundAt) {
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

    const glass = new Map();   // piece actor -> {actor, clone, effect}
    const watched = new Set();

    const make = piece => {
        const actor = new St.Widget({name: 'menu-glass', reactive: false, clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout()});
        const clone = new Clutter.Clone();
        actor.add_child(clone);
        const effect = new PieceGlassEffect();
        actor.add_effect_with_name('tahoe-lock-piece', effect);
        layer.add_child(actor);
        return {actor, clone, effect};
    };

    const place = () => {
        layer.opacity = pointer ? pointer.opacity : 255;
        if (!menu.isOpen) {
            layer.hide();
            return;
        }
        layer.show();
        restack();
        const list = pieces(menu.box);
        const seen = new Set();
        for (const {actor: piece, radius} of list) {
            seen.add(piece);
            if (!glass.has(piece))
                glass.set(piece, make(piece));
            if (!watched.has(piece)) {
                watched.add(piece);
                frame.connect(piece, 'notify::allocation', place);
                frame.connect(piece, 'destroy', () => {
                    glass.get(piece)?.actor.destroy();
                    glass.delete(piece);
                    watched.delete(piece);
                });
            }
            const g = glass.get(piece);
            if (!piece.mapped || !piece.visible) {
                g.actor.hide();
                continue;
            }
            const [x, y] = piece.get_transformed_position();
            const [w, h] = piece.get_transformed_size();
            if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) {
                g.actor.hide();
                continue;
            }
            const background = backgroundAt(x + w / 2, y + h / 2);
            if (g.clone.source !== background)
                g.clone.source = background;
            g.actor.set_position(Math.round(x), Math.round(y));
            g.actor.set_size(Math.round(w), Math.round(h));
            g.clone.set_position(Math.round((background?.x ?? 0) - x), Math.round((background?.y ?? 0) - y));
            g.effect.radius = radius;
            g.actor.show();
        }
        for (const [piece, g] of glass) {
            if (!seen.has(piece))
                g.actor.hide();
        }
    };

    frame.addUndo(() => {
        for (const g of glass.values())
            g.actor.destroy();
        glass.clear();
    });
    frame.connect(menu, 'open-state-changed', place);
    frame.connect(menu.box, 'notify::allocation', place);
    if (pointer) {
        for (const prop of ['opacity', 'translation-x', 'translation-y', 'scale-x', 'scale-y'])
            frame.connect(pointer, `notify::${prop}`, place);
    }
    frame.connect(dialog._backgroundGroup, 'child-added', place);
    place();
}
