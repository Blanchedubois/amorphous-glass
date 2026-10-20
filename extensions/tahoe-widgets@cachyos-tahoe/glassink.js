// Liquid Glass text: an effect that turns whatever text an actor draws into glass, a translucent
// body in the text's own colour with a lit rim where the strokes face up and to the left and a
// soft shade on the other side. Used on the Music lyrics (music.js).
//
// It works from the text's own coverage (alpha), so it needs no mask: the actor is rendered once
// into the effect's texture (only when its contents move or change) and the shader reads the edge
// from the coverage around each pixel. Line opacity (dimmed lines) carries through.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

const DECLARATIONS = `
uniform float gi_px_x;
uniform float gi_px_y;
uniform float gi_fill;
`;
const SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec4 t = texture2D(cogl_sampler0, uv);
    if (t.a < 0.003) {
        cogl_color_out = vec4(0.0);
        return;
    }
    vec3 ink = t.rgb / t.a;
    // the coverage slope: points into the stroke, long at the edge, ~0 inside
    vec2 dx = vec2(gi_px_x, 0.0), dy = vec2(0.0, gi_px_y);
    vec2 g = vec2(texture2D(cogl_sampler0, uv + dx).a - texture2D(cogl_sampler0, uv - dx).a,
                  texture2D(cogl_sampler0, uv + dy).a - texture2D(cogl_sampler0, uv - dy).a);
    float gl = length(g);
    vec2 n = gl > 0.001 ? g / gl : vec2(0.0);
    float edge = clamp(gl * 1.5, 0.0, 1.0);
    vec2 light = normalize(vec2(-0.55, -1.0));          // from the top left
    float lit = max(dot(-n, light), 0.0);
    float shade = max(dot(n, light), 0.0);
    // the all-round rim glow is for light ink; dark ink keeps only the lit side, for contrast
    float glow = 0.06 + 0.24 * dot(ink, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = mix(ink, vec3(1.0), edge * (glow + 0.70 * lit));
    c *= 1.0 - 0.30 * edge * shade;
    // dark glass needs a fuller body than light glass to read on a mid-tone swirl
    float fill = mix(min(gi_fill + 0.32, 1.0), gi_fill, smoothstep(0.2, 0.7, dot(ink, vec3(0.2126, 0.7152, 0.0722))));
    float a = t.a * mix(fill, 1.0, edge * (0.45 + 0.55 * lit));
    cogl_color_out = vec4(c * a, a) * cogl_color_in.a;
`;

export const GlassInkEffect = GObject.registerClass(
class GlassInkEffect extends Clutter.OffscreenEffect {
    // fill: how opaque a light glass body is (0..1), dark glass a third more; the rim is brighter
    _init(fill = 0.6) {
        super._init();
        this._fill = fill;
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(SHADER);
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        const texture = this.get_texture();
        if (!pipeline || !texture)
            return;
        if (!pipeline._tahoeGlassInk) {
            pipeline.add_snippet(this._snippet);
            pipeline._tahoeGlassInk = true;
        }
        pipeline.set_uniform_1f(pipeline.get_uniform_location('gi_px_x'), 1 / texture.get_width());
        pipeline.set_uniform_1f(pipeline.get_uniform_location('gi_px_y'), 1 / texture.get_height());
        pipeline.set_uniform_1f(pipeline.get_uniform_location('gi_fill'), this._fill);
        super.vfunc_paint_target(node, paintContext);
    }
});
