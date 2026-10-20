// Liquid Glass panes for the login screen and the lock screen (shared with tahoe-lockscreen as
// widgets/paneglass.js): a capsule under the password field, a pill behind each account row, the
// cards of the lock screen's widgets and music. The material is tahoe-lockscreen's glass clock
// (glassclock.js) over a shape: the backdrop bends toward the edge, with a lit rim. No Blur My
// Shell (none in the greeter).
//
// The shape. Rounded rectangles and capsules are computed exactly in the shader (a signed
// distance, px): anti-aliasing exact at any resolution, no mask image to draw (the earlier cairo
// mask read as soft and low resolution, user 2026-10-20). Other shapes (glyphs: a clock) come from
// a cairo mask (buildMask): red = coverage, green = depth inside the shape (0 at the edge, 1 from
// EDGE px in), blue = bend strength.
//
// The edge (the user's pick, docs/UNIFIED_LOCK_PLAN.md: C): a crisp 2 px line with a soft 5 px
// glow inside it, lit from the top left; the shader's rim is the only edge (docs/STANDARD.md).
//
// The material: light (a little milk) or dark (a tint as the desktop's dark glass, tokens/glass.json
// dark chip, #222226). GLASS_LOOK decides: 'light' on both screens, whatever the desktop's mode
// (the user, 2026-10-20: light and dark glass together looked wrong; the wallpaper stays dark),
// 'scheme' to follow GNOME's colour scheme, or 'dark'.
//
// Behind each pane is the background it sits on (the greeter's picture, or a clone of the lock
// screen's background actor), placed so its pixels line up with the real one.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const MATERIAL = {
    edge: 10,           // logical px of bevel inside the shape (the bend's band)
    bend: 9,            // logical px the backdrop is pushed at the very edge
    blur: 0.5,          // logical px of softening: just enough to calm the bend's edge (1.5 read as soft)
    contrast: 0.92,
    saturation: 1.1,
    split: 0.05,        // colour split, as a fraction of the bend
    // the edge, C: a crisp line and a softer glow inside it
    rimLine: 2,         // logical px
    rimGlow: 5,         // logical px
    glow: 0.35,         // the glow's strength against the line's
    rim: 0.45,          // light toward the top left
    rimBase: 0.16,      // light all round
    shade: 0.05,        // darkening of the edge facing away from the light
    light: {brightness: 0.03, milk: 0.10, tint: [0, 0, 0], tintAmount: 0},
    // the desktop's dark glass: tokens/glass.json dark chip rgba(34, 34, 38, 0.62)
    dark: {brightness: -0.02, milk: 0, tint: [34 / 255, 34 / 255, 38 / 255], tintAmount: 0.42},
};

export const GLASS_LOOK = 'light';

export function darkScheme() {
    if (GLASS_LOOK !== 'scheme')
        return GLASS_LOOK === 'dark';
    return St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
}

const SHADER_DECLARATIONS = `
uniform float px_x;
uniform float px_y;
uniform float bend_px;
uniform float blur_px;
uniform float contrast;
uniform float saturation;
uniform float brightness;
uniform float milk;
uniform vec3 tint;
uniform float tint_amount;
uniform float rim;
uniform float rim_base;
uniform float shade;
uniform float split;
uniform float edge_px;
uniform float rim_line_px;
uniform float rim_glow_px;
uniform float glow;
uniform float sdf;
uniform float sd_w;
uniform float sd_h;
uniform float sd_pad;
uniform float sd_r;

vec3 tahoe_backdrop(vec2 uv) {
    vec2 b = vec2(blur_px * px_x, blur_px * px_y);
    return (texture2D(cogl_sampler0, uv).rgb * 2.0 +
            texture2D(cogl_sampler0, uv + vec2(b.x, 0.0)).rgb +
            texture2D(cogl_sampler0, uv - vec2(b.x, 0.0)).rgb +
            texture2D(cogl_sampler0, uv + vec2(0.0, b.y)).rgb +
            texture2D(cogl_sampler0, uv - vec2(0.0, b.y)).rgb) / 6.0;
}
`;

const SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    float cov;
    float inside;   // px from the edge, inwards
    vec2 n;         // the normal, pointing into the shape
    float bend_k = 1.0;
    if (sdf > 0.5) {
        // a rounded rectangle, exactly: its signed distance in px (< 0 inside)
        vec2 size = vec2(sd_w, sd_h);
        vec2 p = uv * size - 0.5 * size;
        vec2 q = abs(p) - (0.5 * size - sd_pad - sd_r);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - sd_r;
        cov = clamp(0.5 - d, 0.0, 1.0);
        inside = -d;
        vec2 outward = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        outward *= vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
        n = -outward;
    } else {
        // a mask: coverage, depth over the bevel, bend strength
        vec4 m = texture2D(cogl_sampler1, uv);
        cov = m.r;
        inside = m.g * edge_px;
        bend_k = m.b;
        vec2 g = vec2(texture2D(cogl_sampler1, uv + vec2(2.0 * px_x, 0.0)).g - texture2D(cogl_sampler1, uv - vec2(2.0 * px_x, 0.0)).g,
                      texture2D(cogl_sampler1, uv + vec2(0.0, 2.0 * px_y)).g - texture2D(cogl_sampler1, uv - vec2(0.0, 2.0 * px_y)).g);
        float gl = length(g);
        n = gl > 0.0001 ? g / gl : vec2(0.0);
    }
    float x = clamp(1.0 - inside / edge_px, 0.0, 1.0);   // 1 at the edge, 0 from edge_px in
    float dome = 1.0 - sqrt(max(1.0 - x * x, 0.0));
    vec2 off = -n * dome * bend_px * bend_k * vec2(px_x, px_y);
    vec3 c = vec3(tahoe_backdrop(uv + off * (1.0 + split)).r,
                  tahoe_backdrop(uv + off).g,
                  tahoe_backdrop(uv + off * (1.0 - split)).b);
    c = (c - 0.5) * contrast + 0.5 + brightness;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, saturation);
    c = mix(c, vec3(1.0), milk);
    c = mix(c, tint, tint_amount);
    // the edge: a crisp line rim_line_px wide, a softer glow rim_glow_px in
    float line_ = 1.0 - smoothstep(rim_line_px * 0.6, rim_line_px, inside);
    float halo = glow * (1.0 - smoothstep(0.0, rim_glow_px, inside));
    float r = max(line_, halo) * bend_k;
    float facing = dot(-n, normalize(vec2(-1.0, -1.0)));
    c += r * (rim_base + rim * max(facing, 0.0));
    c *= 1.0 - shade * r * max(-facing, 0.0);
    c = clamp(c, 0.0, 1.0);
    cogl_color_out = vec4(c * cov, cov) * cogl_color_in.a;
`;

// a 1x1 texture for the mask layer when the shape is computed (the snippet samples layer 1 only
// for mask shapes, but the layer must exist)
let blank = null;
function blankTexture() {
    if (!blank) {
        const ctx = global.stage.context.get_backend().get_cogl_context();
        blank = Cogl.Texture2D.new_from_data(ctx, 1, 1, Cogl.PixelFormat.RGB_888, 3, [0, 0, 0]);
    }
    return blank;
}

const GlassEffect = GObject.registerClass(
class TahoeGdmGlassEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._mask = null;
        this._pipeline = null;
        this._uniforms = null;
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, SHADER_DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
    }

    // shape: {sdf: true, pad, radius} (physical px) or {mask: Cogl.Texture2D}; width, height: the
    // texture's size (the shape plus pad on every side), physical px
    setShape(shape, width, height, scale, dark, M = MATERIAL) {
        const look = dark ? M.dark : M.light;
        this._mask = shape.mask ?? blankTexture();
        this._pipeline = null;
        this._uniforms = {
            px_x: 1 / width, px_y: 1 / height,
            bend_px: M.bend * scale, blur_px: M.blur * scale,
            contrast: M.contrast, saturation: M.saturation, split: M.split,
            brightness: look.brightness, milk: look.milk, tint_amount: look.tintAmount,
            rim: M.rim, rim_base: M.rimBase, shade: M.shade,
            edge_px: M.edge * scale, rim_line_px: M.rimLine * scale, rim_glow_px: M.rimGlow * scale, glow: M.glow,
            sdf: shape.sdf ? 1 : 0, sd_w: width, sd_h: height, sd_pad: shape.pad ?? 0, sd_r: shape.radius ?? 0,
        };
        this._tint = look.tint;
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!this._uniforms || !pipeline)
            return;   // no shape yet: draw nothing rather than the bare backdrop
        if (pipeline !== this._pipeline) {
            if (!pipeline._tahoeGdmGlass) {
                pipeline.add_snippet(this._snippet);
                pipeline._tahoeGdmGlass = true;
            }
            pipeline.set_layer_texture(1, this._mask);
            pipeline.set_layer_filters(1, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode(1, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            for (const [name, value] of Object.entries(this._uniforms))
                pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
            pipeline.set_uniform_float(pipeline.get_uniform_location('tint'), 3, 1, this._tint);
            this._pipeline = pipeline;
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export {roundedRect};

// The glass is drawn PAD logical px bigger than its shape on every side: the bend near the edge
// samples the backdrop just outside the shape, and the shape's anti-aliased edge and rim must lie
// inside the texture; drawn edge to edge, both were cut flat (worst at the corners).
const PAD = Math.ceil(MATERIAL.bend) + 4;

// A mask for a shape that is not a rounded rectangle (glyphs). width, height: the shape, physical
// px; pad: physical px on every side; path(cr, x, y, w, h): draws the shape's path.
export function buildMask(width, height, path, scale, pad = 0, edge = MATERIAL.edge, bend = 1) {
    const surface = new Cairo.ImageSurface(Cairo.Format.RGB24, width + 2 * pad, height + 2 * pad);
    const cr = new Cairo.Context(surface);
    cr.setSourceRGB(0, 0, 0);
    cr.paint();
    path(cr, pad, pad, width, height);
    cr.setSourceRGB(1, 0, bend);
    cr.fill();
    // green, depth: the shape eaten from the outline inwards a step at a time (as glassclock.js)
    path(cr, pad, pad, width, height);
    cr.pushGroup();
    cr.setOperator(Cairo.Operator.OVER);
    cr.setSourceRGB(0, 1, 0);
    cr.fillPreserve();
    cr.setOperator(Cairo.Operator.DEST_OUT);
    const steps = Math.max(2, Math.round(2 * edge * scale));
    for (let k = 1; k <= steps; k++) {
        cr.setSourceRGBA(0, 0, 0, 1 / k);
        cr.setLineWidth(k);
        cr.strokePreserve();
    }
    cr.newPath();
    cr.popGroupToSource();
    cr.setOperator(Cairo.Operator.ADD);
    cr.paint();
    cr.$dispose();

    // cairo surfaces have no byte access in GJS: through a PNG in the runtime dir, removed at once
    const file = GLib.build_filenamev([GLib.get_user_runtime_dir(),
        `tahoe-gdm-mask-${GLib.random_int()}.png`]);
    try {
        surface.writeToPNG(file);
        surface.finish();
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(file);
        const ctx = global.stage.context.get_backend().get_cogl_context();
        const format = pixbuf.get_n_channels() === 4 ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
        return Cogl.Texture2D.new_from_data(ctx, pixbuf.get_width(), pixbuf.get_height(), format,
            pixbuf.get_rowstride(), pixbuf.read_pixel_bytes().toArray());
    } finally {
        GLib.unlink(file);
    }
}

// A pane of glass that fills its parent's slot (in a BinLayout). radius: logical px, 'capsule' for
// half the height, or {path(cr, x, y, w, h), bend} for any other shape (drawn into a mask; bend:
// the shape's bend and bevel strength, 1 by default). material: overrides of MATERIAL for this
// pane (a clock's glass is clearer than a card's). reshape() redraws the mask (new text).
// backdrop: a Gio.File (the picture, drawn at monitor size), a
// Clutter.Actor covering the monitor (cloned, e.g. the lock screen's own background), or a
// function returning that actor (looked up again at each layout: GNOME rebuilds the lock
// backgrounds when monitors change, and a clone of the old one would be empty).
export const GlassPane = GObject.registerClass({
    Signals: {'mask-failed': {}},
}, class TahoeGdmGlassPane extends St.Widget {
    _init(backdrop, radius, material = {}) {
        super._init({
            name: 'tahoe-gdm-glass',
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        this._radius = radius;
        this._material = {...MATERIAL, ...material};
        // room around the shape for the bend and the edge: PAD, more for a bigger bend (a clock)
        this._pad = Math.max(PAD, Math.ceil(this._material.bend) + 4);
        // the glass itself: PAD px bigger than this pane on every side (the pane does not clip),
        // holding the backdrop and running the effect over its own allocation
        this._glass = new St.Widget({reactive: false, clip_to_allocation: true});
        this.add_child(this._glass);
        this._sourceOf = typeof backdrop === 'function' ? backdrop : null;
        const actor = this._sourceOf ? this._sourceOf() : backdrop;
        this._backdrop = this._sourceOf || actor instanceof Clutter.Actor
            ? new Clutter.Clone({source: actor ?? null})
            : new St.Widget({style: `background-image: url("${backdrop.get_uri()}"); background-size: cover;`});
        this._glass.add_child(this._backdrop);
        this._effect = new GlassEffect();
        this._glass.add_effect_with_name('tahoe-gdm-glass', this._effect);
        this._shapeKey = '';
        this._maskId = 0;
        this.failed = null;   // set when the shape could not be made; the owner then removes the pane
        // dark or light glass, as GNOME's colour scheme
        this._schemeId = St.Settings.get().connect('notify::color-scheme', () => {
            this._shapeKey = '';
            this.queue_relayout();
        });
        // The backdrop is placed from this pane's place on screen, worked out when the pane is
        // laid out. When something above it moves (the layout module moving the prompt), the
        // pane's own slot does not change and it is not laid out again: so it watches its
        // ancestors and asks for a new layout when any of them moves.
        this._watched = [];
        this.connect('notify::mapped', () => this._watchAncestors());
        this.connect('destroy', () => {
            if (this._maskId)
                GLib.source_remove(this._maskId);
            this._maskId = 0;
            St.Settings.get().disconnect(this._schemeId);
            this._unwatch();
        });
    }

    // the shape changed without a size change (a clock's new minute): draw it again
    reshape() {
        this._shapeKey = '';
        this.queue_relayout();
    }

    _unwatch() {
        this._watched.forEach(([actor, id]) => actor.disconnect(id));
        this._watched = [];
        if (this._relayoutLater)
            global.compositor.get_laters().remove(this._relayoutLater);
        this._relayoutLater = 0;
    }

    _watchAncestors() {
        this._unwatch();
        if (!this.mapped)
            return;
        // not from inside the layout pass that moved the ancestor (Clutter warns): just before the
        // next frame
        const moved = () => {
            if (this._relayoutLater)
                return;
            const laters = global.compositor.get_laters();
            this._relayoutLater = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._relayoutLater = 0;
                this.queue_relayout();
                return GLib.SOURCE_REMOVE;
            });
        };
        for (let a = this.get_parent(); a; a = a.get_parent())
            this._watched.push([a, a.connect('notify::allocation', moved)]);
    }

    _frame() {
        const source = this._backdrop.source;
        const of = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return [x, y, w, h];
        };
        if (source)
            return of(source);
        const group = Main.screenShield?._lockDialogGroup;
        return group ? of(group) : [0, 0, global.stage.width, global.stage.height];
    }

    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const g = new Clutter.ActorBox();
        g.set_origin(-this._pad, -this._pad);
        g.set_size(box.get_width() + 2 * this._pad, box.get_height() + 2 * this._pad);
        this._glass.allocate(g);
        if (this._sourceOf) {
            const current = this._sourceOf();
            if (current !== this._backdrop.source)
                this._backdrop.source = current ?? null;
        }
        // the backdrop lies exactly over the real background, wherever this pane is: a cloned
        // actor at that actor's own place and size (one monitor's lock background); the picture
        // over the whole of the login screen's group, as the theme draws it (any monitor layout)
        const [fx, fy, fw, fh] = this._frame();
        const [sx, sy] = this.get_transformed_position();
        const b = new Clutter.ActorBox();
        b.set_origin(fx - (sx - this._pad), fy - (sy - this._pad));
        b.set_size(fw, fh);
        this._backdrop.allocate(b);

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const w = Math.round(box.get_width() * scale), h = Math.round(box.get_height() * scale);
        const key = `${w}x${h}`;
        // a rounded shape has no mask to draw: set at once, so the glass is there on the first
        // frame (it popped in a frame late on Super+L); a glyph mask is drawn just after the layout
        if (w > 0 && h > 0 && key !== this._shapeKey && typeof this._radius !== 'object') {
            try {
                if (MATERIAL._failForTest)   // set only by tools/gdm (GDM_FAIL_MASK)
                    throw new Error('test: mask failed');
                const pad = this._pad * scale;
                const radius = this._radius === 'capsule' ? h / 2 : Math.min(this._radius * scale, h / 2, w / 2);
                this._effect.setShape({sdf: true, pad, radius}, w + 2 * pad, h + 2 * pad, scale, darkScheme(), this._material);
                this._shapeKey = key;
            } catch (e) {
                this.failed = `${e}`;
                // not from inside the layout pass: the owner removes the pane
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this.emit('mask-failed');
                    return GLib.SOURCE_REMOVE;
                });
                this._shapeKey = key;
            }
            return;
        }
        if (w > 0 && h > 0 && key !== this._shapeKey && !this._maskId) {
            // after the layout pass: a mask is drawn with cairo, and the effect's uniforms change
            this._maskId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._maskId = 0;
                const [aw, ah] = this.get_size();
                const pw = Math.round(aw * scale), ph = Math.round(ah * scale);
                if (pw <= 0 || ph <= 0)
                    return GLib.SOURCE_REMOVE;
                try {
                    if (MATERIAL._failForTest)   // set only by tools/gdm (GDM_FAIL_MASK)
                        throw new Error('test: mask failed');
                    const pad = this._pad * scale;
                    const M = this._material;
                    const shape = typeof this._radius === 'object'
                        ? {mask: buildMask(pw, ph, this._radius.path, scale, pad, M.edge, this._radius.bend ?? 1)}
                        : {sdf: true, pad, radius: this._radius === 'capsule' ? ph / 2 : Math.min(this._radius * scale, ph / 2, pw / 2)};
                    this._effect.setShape(shape, pw + 2 * pad, ph + 2 * pad, scale, darkScheme(), M);
                    this._shapeKey = `${pw}x${ph}`;
                } catch (e) {
                    this.failed = `${e}`;
                    this.emit('mask-failed');
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }
});
