// The view's shaders, each an OffscreenEffect with one Cogl snippet per module (not one per
// instance: every new snippet is a new GL program, and the view is opened many times). Each samples
// its texture with linear filtering (an offscreen effect's own is nearest: anything sampled off the
// pixel grid, a bent rim or a leaning card, came out blocky).
//
// EdgeFade (user, 2026-10-21): the lyrics do not stop at a hard edge; toward the top and bottom of
// their column they blur more and more (a Gaussian-like disc of samples, its radius growing) and fade
// to nothing, as Apple Music's.
//
// GlassEdge (user, 2026-10-21): while hovered, the cover is art set in a Liquid Glass card lit from
// above the pointer: its face reflects the light softly; at its thin rounded edge the art fades out
// and the widgets' glass behind the cover shows through (clear glass, not shaded paint), with a
// glint on the side facing the light, a fainter one opposite and a Fresnel lift (a card's thickness), with the widgets' rim light, edge shadow and 1 px edge (a flat reflection
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
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
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
    // glass, not paint: light on both sides of the edge (bright where it faces the light, a
    // fainter internal reflection opposite), a Fresnel lift toward the very edge, never a grey
    // shade; the 1 px white edge of the widgets' glass
    float facing = length(side) > 0.001 ? dot(n, normalize(side)) : 0.0;
    float rimBand = 1.0 - smoothstep(0.0, 0.45 * ge_band, d);
    float hair = 1.0 - smoothstep(0.6, 1.4, d);
    float rim = 0.55 * rimBand * max(facing, 0.0) + 0.20 * rimBand * max(-facing, 0.0) + 0.16 * hair;
    float fresnel = 0.18 * x * x * x;

    float k = ge_strength;
    float light = clamp((faceSpec + bevelSpec + rim + fresnel) * k, 0.0, 1.0);
    // the art ends inside the edge: across the outer band it fades, and the glass behind the cover
    // (the widgets' Liquid Glass) shows through, so the rim is clear glass with the art set in it
    float art = mix(1.0, smoothstep(0.15 * ge_band, 0.95 * ge_band, d), k);
    vec4 col = vec4(rgb * art, art);
    // the glints over the art and the glass alike
    col = vec4(col.rgb * (1.0 - light) + vec3(light), col.a + light * (1.0 - col.a));
    cogl_color_out = col * a * cogl_color_in.a;
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
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
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

// ---- RoundMask: an actor cut to a rounded rectangle (exact, anti-aliased) ----

const MASK_DECLARATIONS = `
uniform float rm_w;
uniform float rm_h;
uniform float rm_radius;
`;
const MASK_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 p = uv * vec2(rm_w, rm_h);
    vec2 q = abs(p - 0.5 * vec2(rm_w, rm_h)) - (0.5 * vec2(rm_w, rm_h) - rm_radius);
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rm_radius;
    cogl_color_out = texture2D(cogl_sampler0, uv) * clamp(0.5 - dist, 0.0, 1.0) * cogl_color_in.a;
`;

let maskSnippet = null;

export const RoundMask = GObject.registerClass(
class TahoeNpRoundMask extends Clutter.OffscreenEffect {
    // radius: logical px
    _init(radius) {
        super._init();
        this.radius = radius;
        maskSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, MASK_DECLARATIONS, null);
            s.set_replace(MASK_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpMask) {
            pipeline.add_snippet(maskSnippet);
            pipeline._tahoeNpMask = true;
        }
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        const actor = this.get_actor();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        set('rm_w', Math.max(1, actor.width * scale));
        set('rm_h', Math.max(1, actor.height * scale));
        set('rm_radius', this.radius * scale);
        super.vfunc_paint_target(node, paintContext);
    }
});

// ---- Tilt: the cover leaning in 3D, drawn by a shader so its edges stay anti-aliased ----
// Rotating actors in 3D draws their outline without anti-aliasing (the compositor has no MSAA) and
// resamples the art at an angle: the tilted cover looked pixelated (user, 2026-10-21). Here the
// actors stay flat; this effect draws them as one card leaning by (ax, ay) and lifted toward the
// viewer, with the stage's perspective (60 degrees, as Clutter's): for each pixel it casts a ray from
// the eye to the card's plane and samples the flat picture there, with linear filtering, so the
// card's outline is its own anti-aliased rounded edge, smooth at any angle.

const TILT_DECLARATIONS = `
uniform float tl_w;
uniform float tl_h;
uniform float tl_ax;      // radians about the horizontal axis
uniform float tl_ay;      // radians about the vertical axis
uniform float tl_eye;     // px from the eye to the screen
uniform float tl_lift;    // px toward the eye

// the flat picture's colour seen at screen point P (px from the centre) on the leaning card
vec4 tl_sample(vec2 P, vec2 size, vec3 ax, vec3 ay, vec3 az) {
    vec3 eye = vec3(0.0, 0.0, tl_eye);
    vec3 dir = vec3(P, 0.0) - eye;
    vec3 o = vec3(0.0, 0.0, tl_lift);
    float t = dot(az, o - eye) / dot(az, dir);
    vec3 X = eye + t * dir - o;
    vec2 src = (vec2(dot(X, ax), dot(X, ay)) + 0.5 * size) / size;
    if (src.x < 0.0 || src.y < 0.0 || src.x > 1.0 || src.y > 1.0)
        return vec4(0.0);
    return texture2D(cogl_sampler0, src);
}
`;
// four samples a pixel, on a rotated grid (4x supersampling): the outline and the 1 px rim lines
// stay smooth at any lean, where one sample a pixel broke them into steps
const TILT_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 size = vec2(tl_w, tl_h);
    vec2 P = uv * size - 0.5 * size;
    float cx = cos(tl_ax), sx = sin(tl_ax), cy = cos(tl_ay), sy = sin(tl_ay);
    // R = Ry(ay) * Rx(ax); its columns are the card's axes in the world
    vec3 ax = vec3(cy, 0.0, -sy);
    vec3 ay = vec3(sy * sx, cx, cy * sx);
    vec3 az = vec3(sy * cx, -sx, cy * cx);
    vec4 col = 0.25 * (tl_sample(P + vec2(-0.125, -0.375), size, ax, ay, az) +
                       tl_sample(P + vec2( 0.375, -0.125), size, ax, ay, az) +
                       tl_sample(P + vec2( 0.125,  0.375), size, ax, ay, az) +
                       tl_sample(P + vec2(-0.375,  0.125), size, ax, ay, az));
    cogl_color_out = col * cogl_color_in.a;
`;

let tiltSnippet = null;

export const Tilt = GObject.registerClass(
class TahoeNpTilt extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this.ax = 0;     // degrees
        this.ay = 0;
        this.lift = 0;   // logical px
        tiltSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, TILT_DECLARATIONS, null);
            s.set_replace(TILT_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpTilt) {
            pipeline.add_snippet(tiltSnippet);
            pipeline._tahoeNpTilt = true;
        }
        // linear filtering every time (the offscreen pipeline's own setting is nearest)
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        const actor = this.get_actor();
        const k = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const rad = Math.PI / 180;
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        set('tl_w', Math.max(1, actor.width * k));
        set('tl_h', Math.max(1, actor.height * k));
        set('tl_ax', this.ax * rad);
        set('tl_ay', this.ay * rad);
        // the stage's perspective: 60 degrees across its height
        set('tl_eye', global.stage.height * k / 2 / Math.tan(30 * rad));
        set('tl_lift', this.lift * k);
        super.vfunc_paint_target(node, paintContext);
    }
});

// ---- PourMask: the enter's opening shape, cut from a full-size glass card ----
// A rounded rectangle (x, y, width, height, radius px, inside the actor) that can change every frame
// without touching the glass under it (Blur My Shell builds that once); along its moving edge a thin
// rim light from the top left and a little shade opposite, so the opening shape reads as glass.

const POUR_DECLARATIONS = `
uniform float pm_w;
uniform float pm_h;
uniform float pm_x;
uniform float pm_y;
uniform float pm_ww;
uniform float pm_wh;
uniform float pm_radius;
uniform float pm_rim;
`;
const POUR_SHADER = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 p = uv * vec2(pm_w, pm_h);
    vec2 c = vec2(pm_x, pm_y) + 0.5 * vec2(pm_ww, pm_wh);
    vec2 q = abs(p - c) - (0.5 * vec2(pm_ww, pm_wh) - pm_radius);
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - pm_radius;
    float inside = clamp(0.5 - dist, 0.0, 1.0);
    vec4 col = texture2D(cogl_sampler0, uv);
    // the rim: within 3 px of the edge, lit where the edge faces the top left
    vec2 n = normalize(p - c + vec2(0.0001));
    float band = 1.0 - smoothstep(0.0, 3.0, -dist);
    float facing = dot(n, normalize(vec2(-1.0, -1.0)));
    float light = pm_rim * band * (0.16 + 0.55 * max(facing, 0.0));
    float shade = pm_rim * band * 0.30 * max(-facing, 0.0);
    col.rgb = col.rgb * (1.0 - shade) + (col.a - col.rgb * (1.0 - shade)) * light;
    cogl_color_out = col * inside * cogl_color_in.a;
`;

let pourSnippet = null;

export const PourMask = GObject.registerClass(
class TahoeNpPourMask extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this.window = [0, 0, 1, 1];   // x, y, width, height (logical px, inside the actor)
        this.radius = 0;
        this.rim = 1;
        pourSnippet ??= (() => {
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, POUR_DECLARATIONS, null);
            s.set_replace(POUR_SHADER);
            return s;
        })();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeNpPour) {
            pipeline.add_snippet(pourSnippet);
            pipeline._tahoeNpPour = true;
        }
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        const actor = this.get_actor();
        const k = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const set = (name, v) => pipeline.set_uniform_1f(pipeline.get_uniform_location(name), v);
        const [x, y, w, h] = this.window;
        set('pm_w', Math.max(1, actor.width * k));
        set('pm_h', Math.max(1, actor.height * k));
        set('pm_x', x * k);
        set('pm_y', y * k);
        set('pm_ww', w * k);
        set('pm_wh', h * k);
        set('pm_radius', this.radius * k);
        set('pm_rim', this.rim);
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
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
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
