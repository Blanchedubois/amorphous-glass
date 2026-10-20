// Glass Text clock (medium): the day and the time ARE the glass, the wallpaper bends through each
// stroke. After the clock-glass-text widget of jaxparrow07/liquidglass-kde-widgets (GPL-3.0); no
// code or assets are taken from it.
//
// The card is bare (no rim): Blur My Shell's glass fills it as usual, and a shader cuts that glass
// to the glyphs. The glyphs are drawn once a minute with cairo into a mask: red = coverage,
// green = how far inside the stroke (0 at the edge, 1 from EDGE px in). The shader bends the glass
// near each edge, splits the colours a little and lights the edge from the top left. Nothing runs
// per frame beyond that shader, which only runs when the area repaints.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {scaleFactor} from './glass.js';
import {timeParts} from './clocks.js';

const EDGE = 10;          // logical px of bevel inside each stroke
const TIME_FONT = 'SF Pro Rounded Bold';
const DAY_FONT = 'SF Pro Rounded Semibold';
const MASK_FILE = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'tahoe-widgets-glass-text.png']);

// Cogl fragment snippet: layer 0 is the glass (the offscreen copy of the backdrop), layer 1 the mask
const SHADER_DECLARATIONS = `
uniform float px_x;
uniform float px_y;
uniform float bend_px;
uniform float lift;
`;
const SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec4 m = texture2D(cogl_sampler1, uv);
    float cov = m.r;
    vec2 g = vec2(texture2D(cogl_sampler1, uv + vec2(2.0 * px_x, 0.0)).g - texture2D(cogl_sampler1, uv - vec2(2.0 * px_x, 0.0)).g,
                  texture2D(cogl_sampler1, uv + vec2(0.0, 2.0 * px_y)).g - texture2D(cogl_sampler1, uv - vec2(0.0, 2.0 * px_y)).g);
    float gl = length(g);
    vec2 n = gl > 0.0001 ? g / gl : vec2(0.0);    // points into the stroke
    float edge = 1.0 - m.g;                         // 1 at the edge, 0 deep inside
    vec2 off = n * edge * edge * bend_px * vec2(px_x, px_y);
    vec3 c = vec3(texture2D(cogl_sampler0, uv + off * 1.10).r,
                  texture2D(cogl_sampler0, uv + off).g,
                  texture2D(cogl_sampler0, uv + off * 0.90).b);
    float facing = dot(-n, normalize(vec2(-1.0, -1.0)));   // light from the top left
    float rim = smoothstep(0.55, 1.0, edge);
    c += rim * (0.16 + 0.40 * max(facing, 0.0));
    c *= 1.0 - 0.24 * rim * max(-facing, 0.0);
    c += lift;
    cogl_color_out = vec4(min(c, vec3(1.0)), 1.0) * cov * cogl_color_in.a;
`;

const GlyphGlassEffect = GObject.registerClass(
class GlyphGlassEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._mask = null;
        this._pipeline = null;
        this._uniforms = {px_x: 1, px_y: 1, bend_px: 16, lift: 0.04};
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, SHADER_DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
    }

    setMask(texture, width, height, scale) {
        this._mask = texture;
        this._pipeline = null;   // set the new layer at the next paint
        Object.assign(this._uniforms, {px_x: 1 / width, px_y: 1 / height, bend_px: 16 * scale});
        this.queue_repaint();
    }

    setLift(lift) {
        this._uniforms.lift = lift;
        this._pipeline = null;
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        // no glass under it (no Blur My Shell): the fallback labels show instead
        if (!this._mask || !pipeline || this.get_actor().get_n_children() === 0)
            return;
        // the offscreen pipeline is rebuilt when the texture changes: set it up once per pipeline
        if (pipeline !== this._pipeline) {
            if (!pipeline._tahoeGlassText) {
                pipeline.set_layer_texture(1, this._mask);
                pipeline.add_snippet(this._snippet);
                pipeline._tahoeGlassText = true;
            }
            pipeline.set_layer_texture(1, this._mask);
            pipeline.set_layer_filters(1, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode(1, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            for (const [name, value] of Object.entries(this._uniforms))
                pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
            this._pipeline = pipeline;
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

// "19 Monday" over "8:04", centred, as cairo paths in physical px
function glyphPaths(cr, width, height, now, scale) {
    const day = PangoCairo.create_layout(cr);
    const dayFont = Pango.FontDescription.from_string(DAY_FONT);
    dayFont.set_absolute_size(26 * scale * Pango.SCALE);
    day.set_font_description(dayFont);
    day.set_text(`${now.get_day_of_month()} ${now.format('%A')}`, -1);

    const time = PangoCairo.create_layout(cr);
    const timeFont = Pango.FontDescription.from_string(TIME_FONT);
    timeFont.set_absolute_size(100 * scale * Pango.SCALE);
    time.set_font_description(timeFont);
    time.set_text(timeParts(now)[0], -1);

    const [dayInk] = day.get_pixel_extents();
    const [timeInk] = time.get_pixel_extents();
    const gap = 10 * scale;
    const total = dayInk.height + gap + timeInk.height;
    const top = Math.round((height - total) / 2);
    cr.moveTo(Math.round((width - dayInk.width) / 2) - dayInk.x, top - dayInk.y);
    PangoCairo.layout_path(cr, day);
    cr.moveTo(Math.round((width - timeInk.width) / 2) - timeInk.x, top + dayInk.height + gap - timeInk.y);
    PangoCairo.layout_path(cr, time);
}

// the mask as a Cogl texture: red = coverage, green = depth inside the stroke
function buildMask(width, height, now, scale) {
    const surface = new Cairo.ImageSurface(Cairo.Format.RGB24, width, height);
    const cr = new Cairo.Context(surface);
    cr.setSourceRGB(0, 0, 0);
    cr.paint();
    glyphPaths(cr, width, height, now, scale);
    cr.setOperator(Cairo.Operator.ADD);
    cr.setSourceRGB(1, 0, 0);
    cr.fillPreserve();
    // depth: the stroke in green, eaten from the outline inwards a step at a time
    cr.pushGroup();
    cr.setOperator(Cairo.Operator.OVER);
    cr.setSourceRGB(0, 1, 0);
    cr.fillPreserve();
    cr.setOperator(Cairo.Operator.DEST_OUT);
    // stroke k (k px wide) erases 1/k of what is left: what remains at depth d is 2d / steps,
    // an even ramp in 1 px steps
    const steps = Math.round(2 * EDGE * scale);
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
    surface.writeToPNG(MASK_FILE);
    surface.finish();

    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(MASK_FILE);
    GLib.unlink(MASK_FILE);
    const ctx = global.stage.context.get_backend().get_cogl_context();
    const format = pixbuf.get_n_channels() === 4 ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
    return Cogl.Texture2D.new_from_data(ctx, pixbuf.get_width(), pixbuf.get_height(), format,
        pixbuf.get_rowstride(), pixbuf.read_pixel_bytes().toArray());
}

export class GlassTextClock {
    static size = 'medium';
    static bare = true;

    constructor() {
        // without Blur My Shell (and while the mask is built) a plain translucent text stands in
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-glasstext-fallback',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._day = new St.Label({style_class: 'tahoe-glasstext-day', x_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'tahoe-glasstext-time', x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._day);
        this.actor.add_child(this._time);
        this._effect = new GlyphGlassEffect();
        this._shown = null;
        this._card = null;
    }

    attachCard(card) {
        this._card = card;
        card.addBackdropEffect('tahoe-glass-text', this._effect);
        card.actor.connectObject('notify::size', () => this._rebuild(), this);
    }

    setMode(mode) {
        this._effect.setLift(mode === 'light' ? 0.10 : 0.04);
    }

    tick(now) {
        const text = `${now.format('%Y-%m-%d')} ${timeParts(now)[0]}`;
        this._now = now;
        this._day.text = `${now.get_day_of_month()} ${now.format('%A')}`;
        this._time.text = timeParts(now)[0];
        if (text !== this._shown) {
            this._shown = text;
            this._rebuild();
        }
    }

    _rebuild() {
        const actor = this._card?.actor;
        if (!actor || !this._now)
            return;
        const width = Math.ceil(actor.width), height = Math.ceil(actor.height);
        if (width <= 0 || height <= 0)
            return;
        try {
            this._effect.setMask(buildMask(width, height, this._now, scaleFactor()), width, height, scaleFactor());
        } catch (e) {
            console.warn(`tahoe-widgets: glass text mask: ${e}`);
        }
    }

    destroy() {
        this._card?.actor.disconnectObject(this);
        this._card = null;
        this.actor.destroy();
    }
}
