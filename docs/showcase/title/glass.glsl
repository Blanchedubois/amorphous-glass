#version 300 es
// Pass 2 of the title scene: a capsule of the desktop's glass over pass 1.
//
// A WebGL port of the patched Blur My Shell refraction shader that draws every glass surface of
// this desktop (src/effects/refraction/refraction.glsl, config/bms-tahoe-glass.patch), with the
// values of glass_params() in scripts/glass-bar.sh. That shader is itself a GLSL port of
// liquidass 0.1.1b (Tweak.mm kShaderSrc) from Liquid (Gl)ass by winaviation
// (https://github.com/winaviation-tweaks/liquid-ass). Its copyright holder granted, in email and
// in Blur my Shell pull request #987 (2026-09-10), that the ported shader may be re-licensed and
// redistributed under the GNU GPL v3, with the same rights extending to anyone who reuses it from
// that repository. The original upstream project remains licensed under CC BY-NC 4.0. The rim
// light and inner shadow follow liquid-glass by ryohsuke1231 (MIT).
//
// Changes for the title: clear glass (no tint), the edge band scaled to the hero capsule, a
// little magnification (backdrop_zoom), and the analytic capsule drawn here, not by Clutter.
precision highp float;

uniform sampler2D scene;   // pass 1, mipmapped: the blur under the glass is a mip level
uniform vec2 res;
uniform vec4 cap;          // centre x, centre y, width, height (px, y down)
uniform float blur;
uniform float strength;    // x the recipe's 0.8, rises with speed
uniform float show;

out vec4 fragColor;

// glass_params()
const float STRENGTH = 0.8;
const float EDGE_SIZE = 12.0;
const float FALLOFF = 2.4;
const float RIM_WIDTH = 3.0;
const float RGB_FRINGING = 0.06;
const float GLOSS = 0.8;
const float FRESNEL_ANGLE = radians(45.0 + 90.0);   // BMS adds 90 degrees
const float FRESNEL_WIDTH = 1.0;
const float SHADOW = 0.2;
const float RIM_LIGHT = 0.55;
const float RIM_LIGHT_WIDTH = 0.45;
const float AO = 0.3;
const float AO_WIDTH = 0.2;
const float DISPERSION_SCALE = 10.0;
// the title: the capsule is about 7x the 38 px bar; the edge band is scaled with it so the
// refraction reaches the letters
const float SCALE = 8.0;
const float BACKDROP_ZOOM = 1.07;

vec3 sampleScene(vec2 px) {
    px = clamp(px, vec2(1.5), res - 1.5);
    return textureLod(scene, vec2(px.x, res.y - px.y) / res, blur).rgb;
}

float quartzGlassEdgeProfile(float distanceFromEdge, float refractionHeight) {
    float t = clamp(distanceFromEdge / max(refractionHeight, 0.001), 0.0, 1.0);
    return 1.0 - sqrt(t * (2.0 - t));
}

float quartzGlassRing(float distanceFromEdge, float bezelWidth) {
    float ringWidth = clamp(bezelWidth * 0.24 * FRESNEL_WIDTH, 1.0, 2.5 * FRESNEL_WIDTH * SCALE);
    float outerCoverage = clamp(distanceFromEdge + 0.5, 0.0, 1.0);
    float radial = clamp(distanceFromEdge / ringWidth, 0.0, 1.0);
    return outerCoverage * exp(-3.0 * radial);
}

float quartzGlassHighlight(float distanceFromEdge, float bezelWidth, vec2 normal) {
    float ring = quartzGlassRing(distanceFromEdge, bezelWidth);
    vec2 lightDirection = vec2(cos(FRESNEL_ANGLE), sin(FRESNEL_ANGLE));
    float threshold = 0.15;
    float directional = clamp((dot(lightDirection, normal) - threshold) / (1.0 - threshold), 0.0, 1.0);
    float highlight = ring * directional;
    highlight /= 1.0 + (1.0 - highlight) * 1.35;
    return highlight * GLOSS;
}

// slope of the superellipse profile h(t) = (1 - (1 - t)^n)^(1/n), t = 0 at the edge, 1 inside
float tahoeLensSlope(float t) {
    float n = 3.6;
    float u = clamp(1.0 - t, 0.0, 1.0);
    float inner = max(1.0 - pow(u, n), 1e-4);
    return pow(inner, 1.0 / n - 1.0) * pow(u, n - 1.0);
}

vec3 tahoeRimLight(vec3 color, float distFromEdge, float band, vec2 outward) {
    float width = max(band * RIM_LIGHT_WIDTH, 1.0);
    float t = clamp(distFromEdge / width, 0.0, 1.0);
    vec3 normal = normalize(vec3(outward * tahoeLensSlope(t) * 2.5, 1.0));
    float fresnel = pow(1.0 - normal.z, 3.0);
    vec3 light = normalize(vec3(cos(FRESNEL_ANGLE), sin(FRESNEL_ANGLE), 0.38));
    float lit = pow(abs(dot(normal, light)), 1.9);
    float edgeBand = 1.0 - smoothstep(0.0, width, distFromEdge);
    float glow = clamp(mix(pow(edgeBand, 0.85), fresnel, 0.55) * edgeBand * lit * RIM_LIGHT, 0.0, 1.0);
    return 1.0 - (1.0 - color) * (1.0 - glow);
}

vec3 tahoeInnerShadow(vec3 color, float distFromEdge, float band) {
    float width = max(band * AO_WIDTH, 0.5);
    return color * (1.0 - (1.0 - smoothstep(0.0, width, distFromEdge)) * AO);
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
    vec3 base = textureLod(scene, gl_FragCoord.xy / res, 0.0).rgb;

    vec2 halfSize = cap.zw * 0.5;
    float R = min(halfSize.x, halfSize.y);   // a capsule
    vec2 lp = p - cap.xy;
    vec2 q = abs(lp) - halfSize + R;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R;

    if (sd > 0.0 || show < 0.5) {
        // the drop shadow under the glass (0.20)
        float drop = (1.0 - smoothstep(0.0, 60.0, sd - 10.0)) * SHADOW * show;
        fragColor = vec4(base * (1.0 - drop * smoothstep(-30.0, 40.0, lp.y)), 1.0);
        return;
    }

    vec2 core = max(halfSize - R, 0.0);
    vec2 toEdge = lp - clamp(lp, -core, core);
    vec2 dir = length(toEdge) > 0.001 ? normalize(toEdge) : vec2(0.0, -1.0);
    float distFromSide = -sd;

    float bezel = max(1.0, min(EDGE_SIZE * SCALE, min(cap.z, cap.w) * 0.5));
    float refractionBand = min(bezel * 0.35 * RIM_WIDTH, R);
    float glassThickness = max(0.5, EDGE_SIZE * SCALE * 0.55 * FALLOFF);
    float edgeBand = clamp(1.0 - distFromSide / refractionBand, 0.0, 1.0);

    float normDisp = distFromSide < refractionBand
        ? quartzGlassEdgeProfile(distFromSide, glassThickness) : 0.0;
    vec2 dispPx = -dir * normDisp * refractionBand * STRENGTH * strength * edgeBand;
    dispPx += (cap.xy - p) * (1.0 - 1.0 / BACKDROP_ZOOM);

    float dispersion = clamp(RGB_FRINGING * DISPERSION_SCALE * strength, 0.0, 20.0);
    vec2 aberrationPx = -dir * normDisp * dispersion * 0.35 * edgeBand * SCALE;
    vec3 bg = vec3(0.0);
    for (int i = 0; i < 3; i++) {
        float w = 1.0 - float(i) / 3.0;
        vec3 s = sampleScene(p + dispPx + aberrationPx * w);
        bg.r += s.r * w;
        bg.g += s.g * (1.0 - w);
    }
    for (int i = 0; i < 4; i++) {
        float w = float(i) / 3.0;
        vec3 s = sampleScene(p + dispPx - aberrationPx * w);
        bg.g += s.g * (1.0 - w);
        bg.b += s.b * w;
    }
    vec3 col = bg * vec3(0.5, 1.0 / 3.0, 0.5);

    float highlight = quartzGlassHighlight(distFromSide, refractionBand, dir);
    highlight *= mix(0.32, 1.0, dot(col, vec3(0.2126, 0.7152, 0.0722)));
    col = 1.0 - (1.0 - col) * (1.0 - min(highlight, 0.22));
    col = tahoeInnerShadow(col, distFromSide, refractionBand);
    col = tahoeRimLight(col, distFromSide, refractionBand, dir);
    col *= 1.0 - smoothstep(0.25, 1.0, (lp.y + halfSize.y) / cap.w) * SHADOW * 0.20;

    fragColor = vec4(mix(base, col, clamp(distFromSide + 0.5, 0.0, 1.0)), 1.0);
}
