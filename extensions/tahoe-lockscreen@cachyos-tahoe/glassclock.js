// The Liquid Glass clock (docs/LOCKSCREEN_PLAN.md, Phase 4): the date and the time are glass.
// The lock picture shows through each stroke, milky and lighter, bent near the edges, with a rim
// lit from the top left, as on Apple's macOS Tahoe lock screen.
//
// Behind the glass is a Clutter.Clone of GNOME's own lock background, cropped to the clock's box,
// so it always shows exactly the picture under the clock (sharp on the clock page, blurred on the
// password page) and nothing goes stale. A Clutter.OffscreenEffect runs one shader over that:
// layer 0 is the backdrop, layer 1 a glyph mask drawn with cairo once a minute (red = coverage,
// green = how far inside the stroke, 0 at the edge, 1 from EDGE px in).
//
// The material follows the lock screen clock of Kyant0/AndroidLiquidGlass (Apache-2.0; the idea,
// written anew): a milky backdrop (contrast down, saturation up, some white over it) and a dome
// profile across each stroke that bends the backdrop near the edge. The slight colour split
// follows the idea of the KDE Liquid Glass widgets' glass text (GPL-3.0; no code taken). The
// mask technique is our own tahoe-widgets Glass Text widget's.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

// The material, tuned against Apple's press image (the workshop changes these)
export const MATERIAL = {
    timeFont: 'SF Pro Display Heavy',
    dateFont: 'SF Pro Display Semibold',
    round: 2.5,         // logical px: corners softened by growing the glyphs with round joins
    edge: 10,           // logical px of bevel inside the time's strokes
    bend: 22,           // logical px the backdrop is pushed at the very edge of the time
    dateScale: 0.3,     // the date's bevel, bend and rim, as a fraction of the time's
    dateMilk: 0.30,     // extra white in the date, so its thin strokes stay legible
    blur: 0,            // logical px of softening of the backdrop (0: clear glass)
    contrast: 1.0,      // < 1 flattens the picture
    saturation: 1.0,    // > 1 strengthens its colour
    brightness: 0.05,   // a slight lift, so the glass reads lighter than what is behind it
    milk: 0.06,         // how much white is laid over the backdrop
    rim: 0.38,          // rim light toward the top left
    rimBase: 0.14,      // rim light all round
    shade: 0.10,        // darkening of the edge facing away from the light
    split: 0.10,        // colour split, as a fraction of the bend
    // dark mode (GNOME's dark style): the glass a little darker, as the user asked
    darkTint: 0.16,     // how far the glass is pulled toward black
    darkBrightness: -0.02,
};

const SHADER_DECLARATIONS = `
uniform float px_x;
uniform float px_y;
uniform float bend_px;
uniform float blur_px;
uniform float contrast;
uniform float saturation;
uniform float brightness;
uniform float milk;
uniform float rim;
uniform float rim_base;
uniform float shade;
uniform float split;
uniform float date_milk;
uniform float date_scale;
uniform float dark_tint;

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
    vec4 m = texture2D(cogl_sampler1, uv);
    float cov = m.r;
    // the slope of the depth channel: the normal, pointing into the stroke
    vec2 g = vec2(texture2D(cogl_sampler1, uv + vec2(2.0 * px_x, 0.0)).g - texture2D(cogl_sampler1, uv - vec2(2.0 * px_x, 0.0)).g,
                  texture2D(cogl_sampler1, uv + vec2(0.0, 2.0 * px_y)).g - texture2D(cogl_sampler1, uv - vec2(0.0, 2.0 * px_y)).g);
    float gl = length(g);
    vec2 n = gl > 0.0001 ? g / gl : vec2(0.0);
    float x = clamp(1.0 - m.g, 0.0, 1.0);             // 1 at the edge, 0 deep inside
    float dome = 1.0 - sqrt(max(1.0 - x * x, 0.0));   // a round bevel: steep only near the edge
    vec2 off = -n * dome * bend_px * m.b * vec2(px_x, px_y);   // blue: this glyph's bend
    vec3 c = vec3(tahoe_backdrop(uv + off * (1.0 + split)).r,
                  tahoe_backdrop(uv + off).g,
                  tahoe_backdrop(uv + off * (1.0 - split)).b);
    // milky: flatter, more colourful, whiter
    c = (c - 0.5) * contrast + 0.5 + brightness;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, saturation);
    // the date (blue < 1) is thin: a little frosted rather than clear
    float is_date = clamp((1.0 - m.b) / max(1.0 - date_scale, 0.01), 0.0, 1.0);
    c = mix(c, vec3(1.0), milk + date_milk * is_date);
    // dark mode: a slightly darker glass (the rim below stays bright)
    c = mix(c, vec3(0.0), dark_tint);
    // the rim: lit from the top left, a little shade on the far side
    float facing = dot(-n, normalize(vec2(-1.0, -1.0)));
    float r = smoothstep(0.55, 1.0, x) * m.b;   // the rim scales with the glyph
    c += r * (rim_base + rim * max(facing, 0.0));
    c *= 1.0 - shade * r * max(-facing, 0.0);
    c = clamp(c, 0.0, 1.0);
    cogl_color_out = vec4(c * cov, cov) * cogl_color_in.a;
`;

const GlyphGlassEffect = GObject.registerClass(
class TahoeLockGlyphGlassEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._mask = null;
        this._pipeline = null;
        this._uniforms = {};
        this.paints = 0;
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, SHADER_DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
    }

    setMask(texture, width, height, scale, dark = false) {
        this._mask = texture;
        this._pipeline = null;
        const M = MATERIAL;
        this._uniforms = {
            px_x: 1 / width, px_y: 1 / height,
            bend_px: M.bend * scale, blur_px: M.blur * scale,
            contrast: M.contrast, saturation: M.saturation,
            brightness: dark ? M.darkBrightness : M.brightness, dark_tint: dark ? M.darkTint : 0,
            milk: M.milk, rim: M.rim, rim_base: M.rimBase, shade: M.shade, split: M.split,
            date_milk: M.dateMilk, date_scale: M.dateScale,
        };
        this.queue_repaint();
    }

    get ready() {
        return this._mask !== null;
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!this._mask || !pipeline)
            return;
        // the offscreen pipeline is rebuilt when its texture changes: set it up once per pipeline
        if (pipeline !== this._pipeline) {
            if (!pipeline._tahoeLockGlass) {
                pipeline.set_layer_texture(1, this._mask);
                pipeline.add_snippet(this._snippet);
                pipeline._tahoeLockGlass = true;
            }
            pipeline.set_layer_texture(1, this._mask);
            pipeline.set_layer_filters(1, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode(1, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            for (const [name, value] of Object.entries(this._uniforms))
                pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
            this._pipeline = pipeline;
        }
        super.vfunc_paint_target(node, paintContext);
        this.paints++;
    }
});

function layout(cr, font, size, text) {
    const l = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.from_string(font);
    desc.set_absolute_size(size * Pango.SCALE);
    l.set_font_description(desc);
    l.set_text(text, -1);
    return l;
}

// Where the date and the time go, in physical px inside a box of width x height: both centred,
// the date's letters at dateTop, the digits' top gap below the date's letters.
function placeText(cr, width, spec) {
    const date = layout(cr, MATERIAL.dateFont, spec.dateSize, spec.date);
    const time = layout(cr, MATERIAL.timeFont, spec.timeSize, spec.time);
    const [dateInk] = date.get_pixel_extents();
    const [timeInk] = time.get_pixel_extents();
    return {
        date, time,
        dateX: Math.round((width - dateInk.width) / 2) - dateInk.x,
        dateY: spec.dateTop - dateInk.y,
        timeX: Math.round((width - timeInk.width) / 2) - timeInk.x,
        timeY: spec.dateTop + dateInk.height + spec.gap - timeInk.y,
        bottom: spec.dateTop + dateInk.height + spec.gap + timeInk.height,
        width: Math.max(dateInk.width, timeInk.width),
    };
}

// How big the glass box must be (physical px): measured with a scratch surface
export function measure(spec) {
    const surface = new Cairo.ImageSurface(Cairo.Format.A8, 1, 1);
    const cr = new Cairo.Context(surface);
    const p = placeText(cr, 0, spec);
    cr.$dispose();
    surface.finish();
    return {width: p.width, bottom: p.bottom};
}

// The mask texture: red = coverage, green = depth inside the stroke (an even ramp over the bevel),
// blue = how strongly this glyph bends (1 for the time, dateScale for the date, whose strokes are
// much thinner)
export function buildMask(width, height, spec, scale) {
    const surface = new Cairo.ImageSurface(Cairo.Format.RGB24, width, height);
    const cr = new Cairo.Context(surface);
    cr.setSourceRGB(0, 0, 0);
    cr.paint();
    const p = placeText(cr, width, spec);
    const paths = [
        {draw: () => { cr.moveTo(p.dateX, p.dateY); PangoCairo.layout_path(cr, p.date); }, scale: MATERIAL.dateScale},
        {draw: () => { cr.moveTo(p.timeX, p.timeY); PangoCairo.layout_path(cr, p.time); }, scale: 1},
    ];
    for (const {draw, scale: glyphScale} of paths) {
        // red, coverage, and blue, the bend: the glyphs grown by `round` px with round joins,
        // softening every corner; LIGHTEN (max) keeps the values where stroke and fill overlap
        draw();
        cr.setOperator(Cairo.Operator.LIGHTEN);
        cr.setSourceRGB(1, 0, glyphScale);
        if (MATERIAL.round > 0) {
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineWidth(2 * MATERIAL.round * scale);
            cr.strokePreserve();
        }
        cr.fill();
        // green, depth: the stroke eaten from the outline inwards a step at a time; stroke k
        // (k px wide) erases 1/k of what is left, so what remains at depth d is 2d / steps
        draw();
        cr.pushGroup();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setSourceRGB(0, 1, 0);
        cr.fillPreserve();
        cr.setOperator(Cairo.Operator.DEST_OUT);
        const steps = Math.max(2, Math.round(2 * MATERIAL.edge * glyphScale * scale));
        for (let k = 1; k <= steps; k++) {
            cr.setSourceRGBA(0, 0, 0, 1 / k);
            cr.setLineWidth(k);
            cr.strokePreserve();
        }
        cr.newPath();
        cr.popGroupToSource();
        cr.setOperator(Cairo.Operator.ADD);
        cr.paint();
    }
    cr.$dispose();

    // cairo surfaces have no byte access in GJS: through a PNG in the runtime dir, removed at once
    const file = GLib.build_filenamev([GLib.get_user_runtime_dir(),
        `tahoe-lockscreen-mask-${GLib.random_int()}.png`]);
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

// The glass: a box over the clock holding a clone of the lock background, offset so the clone's
// pixels line up with the real background, run through the glyph shader.
export class GlassClock {
    constructor() {
        this.actor = new St.Widget({
            name: 'glass-clock',
            reactive: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._clone = new Clutter.Clone();
        this.actor.add_child(this._clone);
        this.effect = new GlyphGlassEffect();
        this.actor.add_effect_with_name('tahoe-lock-glass', this.effect);
    }

    // source: the lock background actor of this monitor; x, y: where the box sits on the monitor
    setBackdrop(source, x, y) {
        this._clone.source = source;
        this._clone.set_position(-x, -y);
    }

    setMask(texture, width, height, scale, dark) {
        this.effect.setMask(texture, width, height, scale, dark);
    }

    get hasBackdrop() {
        return !!this._clone.source;
    }
}
