#version 300 es
// Pass 3 of the glass title: the liquid glass itself, the lock screen clock's material
// (extensions/tahoe-lockscreen@cachyos-tahoe/widgets/paneglass.js, variant B2 "clear blur" of
// clockpanes.js) over one shape: a blend of the drop (an ellipse) and the word (its signed
// distance field). The picture shows through frosted, a little lighter and more saturated, no
// bend (the user: glass without refraction); the desktop widgets' edge: a rim light from the
// top left and a 1 px hairline; and a soft drop shadow under it, as under every desktop glass.
precision highp float;

uniform sampler2D scene;   // pass 1: what lies under the glass
uniform sampler2D frost;   // pass 2: the same, frosted (half res)
uniform sampler2D sdf;     // the word's signed distance, px, < 0 inside (y down)
uniform vec2 res;
uniform vec4 blob;         // the drop: centre x, centre y, width, height (px, y down)
uniform float morph;       // 0: the drop, 1: the word
uniform float fade;        // the glass's presence
uniform float shadow;      // the drop shadow's strength (0.20 on the desktop, 0 on the lock clock)
uniform float gain;        // this moment's share of the frame (motion blur)

out vec4 fragColor;

// clockpanes.js CLOCK_VARIANTS.B2
const float BRIGHTNESS = 0.10;
const float MILK = 0.10;
const float SATURATION = 1.1;
const float BAND = 8.0;            // px: the edge band
const float RIM_LIGHT = 0.35;
const float RIM_LIGHT_WIDTH = 0.45;
const float HAIR = 1.0;            // px
const float HAIR_ALPHA = 0.16;
const float SMOOTH_K = 60.0;       // px: how roundly the letters bud out of the drop

// the desktop's rim light (paneglass.js tahoe_lens_slope, from the Blur My Shell patch)
float lensSlope(float t) {
    float n = 3.6;
    float u = clamp(1.0 - t, 0.0, 1.0);
    float inner = max(1.0 - pow(u, n), 1e-4);
    return pow(inner, 1.0 / n - 1.0) * pow(u, n - 1.0);
}

float sdEllipse(vec2 p, vec2 r) {
    // a scaled circle: exact for a circle, close enough for the drop's slight squash
    float k = min(r.x, r.y);
    return (length(p / r) - 1.0) * k;
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// the shape at `p` (px, y down)
float sd(vec2 p) {
    float drop = sdEllipse(p - blob.xy, blob.zw * 0.5);
    float word = texture(sdf, p / res).r;
    // the morph: the drop's field becomes the word's; a smooth union with the shrinking drop keeps
    // the letters budding out of one body rather than cut by a straight blend
    float between = mix(drop, word, morph);
    float body = drop + morph * SMOOTH_K * 1.5;   // the drop drains as the word fills
    return mix(smin(between, body, SMOOTH_K * (1.0 - morph) + 1.0), word, morph * morph);
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
    vec2 fuv = gl_FragCoord.xy / res;
    vec3 base = texture(scene, fuv).rgb;

    float d = sd(p);
    float cov = clamp(0.5 - d, 0.0, 1.0) * fade;

    // the drop shadow under the glass, offset down, soft
    float ds = sd(p - vec2(0.0, 14.0));
    float drop = (1.0 - smoothstep(0.0, 44.0, ds)) * shadow * fade;
    base *= 1.0 - drop;

    if (cov <= 0.0) {
        fragColor = vec4(base * gain, gain);
        return;
    }

    // the normal, pointing into the shape
    vec2 g = vec2(sd(p + vec2(1.0, 0.0)) - sd(p - vec2(1.0, 0.0)),
                  sd(p + vec2(0.0, 1.0)) - sd(p - vec2(0.0, 1.0)));
    float glen = length(g);
    vec2 n = glen > 0.0001 ? -g / glen : vec2(0.0);
    float inside = -d;

    // the frosted backdrop, lighter, milkier, a touch more saturated
    vec3 c = texture(frost, fuv).rgb;
    c += BRIGHTNESS;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, SATURATION);
    c = mix(c, vec3(1.0), MILK);

    // the desktop widgets' edge: rim light, then the hairline (paneglass.js, desk)
    float w = max(BAND * RIM_LIGHT_WIDTH, 1.0);
    float t = clamp(inside / w, 0.0, 1.0);
    vec3 nn = normalize(vec3(-n * lensSlope(t) * 2.5, 1.0));
    float fres = pow(1.0 - nn.z, 3.0);
    vec3 light = normalize(vec3(cos(45.0), sin(45.0), 0.38));   // as paneglass.js (radians)
    float lit = pow(abs(dot(nn, light)), 1.9);
    float eb = 1.0 - smoothstep(0.0, w, inside);
    float glow = clamp(mix(pow(eb, 0.85), fres, 0.55) * eb * lit * RIM_LIGHT, 0.0, 1.0);
    c = 1.0 - (1.0 - c) * (1.0 - glow);
    float hl = clamp((HAIR - inside) + 0.5, 0.0, 1.0);
    c = mix(c, vec3(1.0), hl * HAIR_ALPHA);
    c = clamp(c, 0.0, 1.0);

    fragColor = vec4(mix(base, c, cov) * gain, gain);
}
