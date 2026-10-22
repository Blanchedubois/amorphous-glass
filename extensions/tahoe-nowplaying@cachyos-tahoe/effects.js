// Two small shaders of the view, each an OffscreenEffect with one Cogl snippet per module (not one
// per instance: every new snippet is a new GL program, and the view is opened many times).
//
// EdgeFade (user, 2026-10-21): the lyrics do not stop at a hard edge; toward the top and bottom of
// their column they blur more and more (a Gaussian-like disc of samples, its radius growing) and fade
// to nothing, as Apple Music's.
//
// GlassEdge (user, 2026-10-21): while hovered, the cover is a Liquid Glass card lit from above the
// pointer: its face reflects the light softly, its thin rounded edge catches a glint and falls into
// shade (a card's thickness, not a tile's), with the widgets' rim light, edge shadow and 1 px edge (a flat reflection
// over the art alone made the cover look flat, user 2026-10-21).
//
// Sheen: the light on the cover while it tilts: a soft highlight that follows the pointer and a
// faint diagonal band that slides with the tilt, cut to the cover's rounded shape (an exact signed
// distance), drawn over it.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';

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

// ---- GlassEdge ----

const EDGE_DECLARATIONS = `
uniform float ge_w;
uniform float ge_h;
uniform float ge_radius;
uniform float ge_band;        // px of bevel inside the edge
uniform float ge_bend;        // px the art is pushed at the very edge
uniform float ge_strength;    // 0: the plain cover
uniform float ge_px;          // the light: above the pointer, 0..1 of the cover
uniform float ge_py;

float ge_sdf(vec2 p) {
    vec2 q = abs(p - 0.5 * vec2(ge_w, ge_h)) - (0.5 * vec2(ge_w, ge_h) - ge_radius);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ge_radius;
}
`;
// The cover as a thick glass tile lit by one light above the pointer: a flat face and a rounded
// bevel at the edge. The face shows a soft reflection of the light; the bevel, sloping away,
// catches a sharp glint where it faces the light and falls into shade where it faces away, which
// is what reads as thickness. Over that, the widgets' glass edge: rim light, edge shadow, 1 px
// white edge (docs/STANDARD.md dark numbers), and the art bent slightly at the rim.
const EDGE_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 size = vec2(ge_w, ge_h);
    vec2 p = uv * size;
    float d = -ge_sdf(p);                               // px inside the edge
    vec2 n = vec2(ge_sdf(p + vec2(1.0, 0.0)) - ge_sdf(p - vec2(1.0, 0.0)),
                  ge_sdf(p + vec2(0.0, 1.0)) - ge_sdf(p - vec2(0.0, 1.0)));
    n = length(n) > 0.0001 ? normalize(n) : vec2(0.0);  // in the plane, pointing outward
    float x = clamp(1.0 - d / ge_band, 0.0, 1.0);       // 1 at the edge, 0 past the bevel
    float dome = 1.0 - sqrt(max(1.0 - x * x, 0.0));     // the bevel's drop: steep only at the edge
    // the art, bent slightly outward at the rim (a lens)
    vec2 off = -n * dome * ge_bend * ge_strength / size;
    vec4 c = texture2D(cogl_sampler0, uv + off);
    float a = texture2D(cogl_sampler0, uv).a;
    vec3 rgb = c.a > 0.004 ? c.rgb / c.a : vec3(0.0);

    // the surface normal: up on the face, tilting outward over the bevel
    float slope = x / sqrt(max(1.0 - x * x, 0.04));
    vec3 N = normalize(vec3(n * slope * ge_strength, 1.0));
    // two views of one light: for the face, a lamp just above the pointer (its reflection sits under
    // the pointer); for the bevel, the light coming from the pointer's side of the cover, so the
    // edges nearest the pointer catch it and the far ones fall into shade
    vec2 ptr = vec2(ge_px, ge_py);
    vec3 V = vec3(0.0, 0.0, 1.0);
    float lift = 0.55 * max(size.x, size.y);
    vec3 Lp = normalize(vec3(ptr * size - p, lift));
    vec2 side = ptr - 0.5;
    side = length(side) > 0.001 ? normalize(side) * min(1.0, 2.0 * length(side)) : vec2(0.0);
    vec3 L = normalize(vec3(side * 0.85, 0.55));
    float onBevel = smoothstep(0.02, 0.25, x);
    // the face: a soft, broad reflection; the bevel: a sharp glint
    float faceSpec = 0.22 * pow(max(dot(V, normalize(Lp + V)), 0.0), 18.0) * (1.0 - onBevel);
    float bevelSpec = 0.70 * pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * onBevel;
    // the bevel turned from the light is darker than the face, turned to it a little lighter
    float turn = dot(N, L) - dot(V, L);
    float shadeBevel = 0.25 * max(-turn, 0.0) * onBevel;
    float lightBevel = 0.15 * max(turn, 0.0) * onBevel;

    // the widgets' glass edge, its light on the side of the edge facing the light
    float facing = length(side) > 0.001 ? dot(n, normalize(side)) : 0.0;
    float rimBand = 1.0 - smoothstep(0.0, 0.45 * ge_band, d);
    float aoBand = 1.0 - smoothstep(0.0, 0.20 * ge_band, d);
    float hair = 1.0 - smoothstep(0.6, 1.4, d);
    float rim = 0.55 * rimBand * max(facing, 0.0) + 0.16 * hair;
    float ao = 0.30 * aoBand * max(-facing, 0.0);

    float k = ge_strength;
    float shade = clamp((shadeBevel + ao) * k, 0.0, 0.85);
    float light = clamp((faceSpec + bevelSpec + lightBevel + rim) * k, 0.0, 1.0);
    rgb = rgb * (1.0 - shade);
    rgb = rgb + (1.0 - rgb) * light;
    cogl_color_out = vec4(rgb * a, a) * cogl_color_in.a;
`;

let edgeSnippet = null;

export const GlassEdge = GObject.registerClass(
class TahoeNpGlassEdge extends Clutter.OffscreenEffect {
    // radius, band, bend: physical px
    _init(radius, band, bend) {
        super._init();
        this.radius = radius;
        this.band = band;
        this.bend = bend;
        this.strength = 0;
        this.pointer = [0.25, 0.25];   // the light, above this point of the cover (0..1)
        edgeSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, EDGE_DECLARATIONS, null);
            s.set_replace(EDGE_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpEdge) {
            pipeline.add_snippet(edgeSnippet);
            pipeline._tahoeNpEdge = true;
        }
        const actor = this.get_actor();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        set('ge_w', Math.max(1, actor.width * scale));
        set('ge_h', Math.max(1, actor.height * scale));
        set('ge_radius', this.radius);
        set('ge_band', this.band);
        set('ge_bend', this.bend);
        set('ge_strength', this.strength);
        set('ge_px', this.pointer[0]);
        set('ge_py', this.pointer[1]);
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
