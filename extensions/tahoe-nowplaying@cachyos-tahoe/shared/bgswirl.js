// The album-colour swirl as a whole background (the lock screen's music mode, and the login
// screen's when the user's session plays behind it): swirl.js' wave field, cross-faded over the
// picture of the actor it is on (lm_amount 0..1). Self-contained (no imports from the widgets), so
// the login screen can carry an exact copy (tools/gdm/shared.list).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

export const DIM = 0.14;   // the swirl a little deeper, for the white clock and text
// palette.js swirlPalette(null): a neutral grey field until the cover's colours are read
const NEUTRAL = [[0.5, 0.5, 0.5], [0.6, 0.6, 0.6], [0.42, 0.42, 0.42], [0.54, 0.54, 0.54]];

// ---- the swirl as the whole background: swirl.js' wave field over the picture ----
const DECLARATIONS = `
uniform float lm_t;
uniform float lm_aspect;
uniform float lm_amount;
uniform float lm_dim;
uniform vec3 lm_c0;
uniform vec3 lm_c1;
uniform vec3 lm_c2;
uniform vec3 lm_c3;
`;
const FIELD = `
    vec2 uv = cogl_tex_coord0_in.st;
    vec4 bg = texture2D(cogl_sampler0, uv);
    float t = lm_t;
    vec2 p = (uv - 0.5) * vec2(lm_aspect, 1.0) * 2.2;
    float ang = t * 0.04;
    float ca = cos(ang), sa = sin(ang);
    p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    p += 0.55 * vec2(sin(p.y * 1.3 + t * 0.21), cos(p.x * 1.1 - t * 0.17));
    p += 0.35 * vec2(sin(p.y * 2.1 - t * 0.15 + 1.7), cos(p.x * 1.9 + t * 0.19 + 0.6));
    p += 0.20 * vec2(sin(p.y * 3.3 + t * 0.12 + 3.1), cos(p.x * 2.9 - t * 0.14 + 2.2));
    float u = smoothstep(-0.9, 0.9, sin(p.x * 1.2 + p.y * 0.6 + t * 0.10));
    float v = smoothstep(-0.9, 0.9, sin(p.y * 1.4 - p.x * 0.5 - t * 0.08 + 1.3));
    vec3 field = mix(mix(lm_c0, lm_c1, u), mix(lm_c2, lm_c3, u), v);
    field *= 1.0 - lm_dim;
    field += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
    cogl_color_out = vec4(mix(bg.rgb, field, lm_amount), 1.0) * cogl_color_in.a;
`;

export const BackgroundSwirl = GObject.registerClass(
class TahoeLockBackgroundSwirl extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        this._snippet.set_replace(FIELD);
        this.floats = {lm_t: Math.random() * 200, lm_aspect: 16 / 9, lm_amount: 0, lm_dim: DIM};
        this.colours = NEUTRAL;
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (!pipeline)
            return;
        if (!pipeline._tahoeLockSwirl) {
            pipeline.add_snippet(this._snippet);
            pipeline._tahoeLockSwirl = true;
        }
        const actor = this.get_actor();
        this.floats.lm_aspect = Math.max(1, actor.width) / Math.max(1, actor.height);
        for (const [name, value] of Object.entries(this.floats))
            pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
        this.colours.forEach((c, i) =>
            pipeline.set_uniform_float(pipeline.get_uniform_location(`lm_c${i}`), 3, 1, c));
        super.vfunc_paint_target(node, paintContext);
    }
});

