// Two small shaders of the view, each an OffscreenEffect with one Cogl snippet per module (not one
// per instance: every new snippet is a new GL program, and the view is opened many times).
//
// EdgeFade (user, 2026-10-21): the lyrics do not stop at a hard edge; toward the top and bottom of
// their column they blur more and more (a Gaussian-like disc of samples, its radius growing) and fade
// to nothing, as Apple Music's.
//
// Sheen: the light on the cover while it tilts: a soft highlight that follows the pointer and a
// faint diagonal band that slides with the tilt, cut to the cover's rounded shape (an exact signed
// distance), drawn over it.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

// ---- EdgeFade ----

const FADE_DECLARATIONS = `
uniform float ef_band;      // the fade's height, as a fraction of the actor's
uniform float ef_blur;      // px of blur at the very edge
uniform float ef_px_x;
uniform float ef_px_y;
`;
// 12 samples on two rings (a cheap Gaussian-like disc) plus the centre, radius r px
const FADE_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    float d = min(uv.y, 1.0 - uv.y) / max(ef_band, 0.0001);   // 0 at the edge, 1 past the band
    float k = clamp(1.0 - d, 0.0, 1.0);
    float r = k * k * ef_blur;
    vec4 c = texture2D(cogl_sampler0, uv) * 0.2;
    if (r > 0.3) {
        vec2 s = vec2(ef_px_x, ef_px_y) * r;
        c += 0.10 * (texture2D(cogl_sampler0, uv + s * vec2( 0.50,  0.00)) + texture2D(cogl_sampler0, uv + s * vec2(-0.50,  0.00)) +
                     texture2D(cogl_sampler0, uv + s * vec2( 0.00,  0.50)) + texture2D(cogl_sampler0, uv + s * vec2( 0.00, -0.50)));
        c += 0.05 * (texture2D(cogl_sampler0, uv + s * vec2( 0.71,  0.71)) + texture2D(cogl_sampler0, uv + s * vec2(-0.71,  0.71)) +
                     texture2D(cogl_sampler0, uv + s * vec2( 0.71, -0.71)) + texture2D(cogl_sampler0, uv + s * vec2(-0.71, -0.71)) +
                     texture2D(cogl_sampler0, uv + s * vec2( 1.00,  0.00)) + texture2D(cogl_sampler0, uv + s * vec2(-1.00,  0.00)) +
                     texture2D(cogl_sampler0, uv + s * vec2( 0.00,  1.00)) + texture2D(cogl_sampler0, uv + s * vec2( 0.00, -1.00)));
    } else {
        c = texture2D(cogl_sampler0, uv);
    }
    float a = smoothstep(0.0, 1.0, clamp(d, 0.0, 1.0));
    cogl_color_out = c * a * cogl_color_in.a;
`;

let fadeSnippet = null;

export const EdgeFade = GObject.registerClass(
class TahoeNpEdgeFade extends Clutter.OffscreenEffect {
    // band: the fade's height, px; blur: px of blur at the edge
    _init(band, blur) {
        super._init();
        this._band = band;
        this._blur = blur;
        fadeSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, FADE_DECLARATIONS, null);
            s.set_replace(FADE_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpFade) {
            pipeline.add_snippet(fadeSnippet);
            pipeline._tahoeNpFade = true;
        }
        const actor = this.get_actor();
        const w = Math.max(1, actor.width), h = Math.max(1, actor.height);
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        set('ef_band', this._band / h);
        set('ef_blur', this._blur);
        set('ef_px_x', 1 / w);
        set('ef_px_y', 1 / h);
        super.vfunc_paint_target(node, paintContext);
    }
});

// ---- Sheen ----

const SHEEN_DECLARATIONS = `
uniform float sh_w;
uniform float sh_h;
uniform float sh_radius;
uniform float sh_x;          // the pointer, 0..1 of the cover
uniform float sh_y;
uniform float sh_strength;   // 0: none
uniform float sh_band;       // where the diagonal band crosses, -1..1
`;
const SHEEN_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 p = uv * vec2(sh_w, sh_h);
    // the cover's rounded rectangle, exactly (1 inside, 0 outside, a pixel of anti-aliasing)
    vec2 q = abs(p - 0.5 * vec2(sh_w, sh_h)) - (0.5 * vec2(sh_w, sh_h) - sh_radius);
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - sh_radius;
    float inside = clamp(0.5 - dist, 0.0, 1.0);
    // a soft highlight around the pointer, and a faint band across the cover
    float spot = exp(-3.2 * dot(uv - vec2(sh_x, sh_y), uv - vec2(sh_x, sh_y)) / 0.18);
    float diag = (uv.x + uv.y) - 1.0 - sh_band;
    float band = exp(-diag * diag / 0.012);
    float light = clamp(0.42 * spot + 0.10 * band, 0.0, 1.0) * sh_strength * inside;
    cogl_color_out = vec4(vec3(light), light) * cogl_color_in.a;
`;

let sheenSnippet = null;

export const Sheen = GObject.registerClass(
class TahoeNpSheen extends Clutter.OffscreenEffect {
    _init(radius) {
        super._init();
        this.radius = radius;
        this.x = 0.5;
        this.y = 0.5;
        this.strength = 0;
        this.band = 0;
        sheenSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, SHEEN_DECLARATIONS, null);
            s.set_replace(SHEEN_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpSheen) {
            pipeline.add_snippet(sheenSnippet);
            pipeline._tahoeNpSheen = true;
        }
        const actor = this.get_actor();
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        set('sh_w', Math.max(1, actor.width));
        set('sh_h', Math.max(1, actor.height));
        set('sh_radius', this.radius);
        set('sh_x', this.x);
        set('sh_y', this.y);
        set('sh_strength', this.strength);
        set('sh_band', this.band);
        super.vfunc_paint_target(node, paintContext);
    }
});
