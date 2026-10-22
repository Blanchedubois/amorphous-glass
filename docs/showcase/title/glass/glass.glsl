#version 300 es
// Pass 3 of the glass title: the liquid glass word itself, as a layer (premultiplied colour and
// coverage) that pass 4 blurs and lays over the scene. The lock screen clock's material
// (extensions/tahoe-lockscreen@cachyos-tahoe/widgets/paneglass.js, variant B2 "clear blur" of
// clockpanes.js) on the word's signed distance field: the picture shows through frosted, a
// little lighter and more saturated, bent a little toward the edge with a slight colour split
// (the user: "glassier with slight refraction"); the desktop widgets' edge: a rim light from the
// top left, an inner shade and a light line.
precision highp float;

uniform sampler2D frost;   // pass 2: the scene, frosted (half res)
uniform sampler2D sdf;     // the word's signed distance, px, < 0 inside (y down)
uniform vec2 res;
uniform float fade;        // the glass's presence

out vec4 fragColor;

// clockpanes.js CLOCK_VARIANTS.B2, made a little lighter (the user, 2026-10-22), with the
// desktop widgets' edge (paneglass.js DESKTOP: the rim band, its light, the inner shade and
// the hairline), the line thicker than the clock's: a thicker outline, as the widgets' (user)
uniform float brightness;      // 0.14
uniform float milk;            // 0.16
const float SATURATION = 1.1;
const float BAND = 12.6;           // px: the edge band (edge_size 12 x 0.35 x rim_width 3)
const float RIM_LIGHT = 0.55;
const float RIM_LIGHT_WIDTH = 0.45;
const float AO = 0.30;             // the inner shade inside the line
const float AO_WIDTH = 0.20;
uniform float hair;            // px: the line (2.5)
uniform float hairAlpha;       // 0.40
// the refraction (paneglass.js: the dome profile across the edge band, the backdrop pushed at
// the edge; between the widgets' A2 "a touch of liquid" and A3)
uniform float bend;            // px the backdrop is pushed at the very edge (6)
const float EDGE = 14.0;           // px: the band the bend works over
const float SPLIT = 0.06;          // colour split, as a fraction of the bend

// the desktop's rim light (paneglass.js tahoe_lens_slope, from the Blur My Shell patch)
float lensSlope(float t) {
    float n = 3.6;
    float u = clamp(1.0 - t, 0.0, 1.0);
    float inner = max(1.0 - pow(u, n), 1e-4);
    return pow(inner, 1.0 / n - 1.0) * pow(u, n - 1.0);
}

float sd(vec2 p) {
    return texture(sdf, p / res).r;
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
    vec2 fuv = gl_FragCoord.xy / res;

    float d = sd(p);
    float cov = clamp(0.5 - d, 0.0, 1.0) * fade;
    if (cov <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    // the normal, pointing into the shape (p space, y down)
    vec2 g = vec2(sd(p + vec2(1.0, 0.0)) - sd(p - vec2(1.0, 0.0)),
                  sd(p + vec2(0.0, 1.0)) - sd(p - vec2(0.0, 1.0)));
    float glen = length(g);
    vec2 n = glen > 0.0001 ? -g / glen : vec2(0.0);
    float inside = -d;

    // the bend: a dome profile, steep only at the edge, pushes the backdrop outward there
    float x = clamp(1.0 - inside / EDGE, 0.0, 1.0);
    float dome = 1.0 - sqrt(max(1.0 - x * x, 0.0));
    vec2 off = vec2(-n.x, n.y) * dome * bend / res;   // into the frost's space (y up)
    vec3 c = vec3(texture(frost, fuv + off * (1.0 + SPLIT)).r,
                  texture(frost, fuv + off).g,
                  texture(frost, fuv + off * (1.0 - SPLIT)).b);
    // lighter, milkier, a touch more saturated
    c += brightness;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, SATURATION);
    c = mix(c, vec3(1.0), milk);

    // the desktop widgets' edge: inner shade, rim light, then the line (paneglass.js, desk)
    float aow = max(BAND * AO_WIDTH, 0.5);
    c *= 1.0 - (1.0 - smoothstep(0.0, aow, inside)) * AO;
    float w = max(BAND * RIM_LIGHT_WIDTH, 1.0);
    float t = clamp(inside / w, 0.0, 1.0);
    vec3 nn = normalize(vec3(-n * lensSlope(t) * 2.5, 1.0));
    float fres = pow(1.0 - nn.z, 3.0);
    vec3 light = normalize(vec3(cos(45.0), sin(45.0), 0.38));   // as paneglass.js (radians)
    float lit = pow(abs(dot(nn, light)), 1.9);
    float eb = 1.0 - smoothstep(0.0, w, inside);
    float glow = clamp(mix(pow(eb, 0.85), fres, 0.55) * eb * lit * RIM_LIGHT, 0.0, 1.0);
    c = 1.0 - (1.0 - c) * (1.0 - glow);
    float hl = clamp((hair - inside) + 0.5, 0.0, 1.0);
    c = mix(c, vec3(1.0), hl * hairAlpha);
    c = clamp(c, 0.0, 1.0);

    fragColor = vec4(c * cov, cov);
}
