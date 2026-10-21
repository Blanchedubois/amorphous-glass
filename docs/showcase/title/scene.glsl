#version 300 es
// Pass 1 of the title scene: the wallpaper (or the montage's frame, the plate) under the camera,
// and the word over it, melted where the glass is and where it has been. Written to a mipmapped
// texture that pass 2, the glass, refracts.
precision highp float;

uniform sampler2D wall;       // the bare wallpaper
uniform sampler2D plate;      // the montage's frame: the same wallpaper with bar, dock and widgets
uniform sampler2D text;       // the word, white on transparent
uniform sampler2D textBlur;   // the same, blurred: cut at a low threshold, letters run together
uniform vec2 res;
uniform float t;
uniform float cam;            // camera zoom, about the centre
uniform float wallpaper;      // 1: the wallpaper, 0: the plate
uniform float textIn;
uniform float melt;           // 0: crisp, 1: melted under and behind the glass
uniform float front;          // the glass's centre x
uniform float halfW;          // half its width
uniform float wakeLen;        // how far behind it the letters are still melted (px)
uniform float gone;           // 1: the letters it has passed are gone
uniform float dir;            // its direction: 1 left to right, -1 back

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);

    // the melt field: under the lens (softly: the refraction does the rest) and in its wake
    float d = (front - p.x) * dir;   // > 0: the glass has passed
    // every term is continuous across the glass: a step here shows as a vertical seam in the
    // letters under it (the wake used to start at full melt right at the glass's centre)
    float lens = 0.55 * (1.0 - smoothstep(halfW * 0.5, halfW + 60.0, abs(d)));
    float behind = smoothstep(-halfW * 0.5, halfW * 0.5, d);
    float wake = behind * exp(-max(d, 0.0) / max(wakeLen, 1.0));
    float m = melt * max(lens, mix(wake, behind, gone));
    float fade = 1.0 - gone * smoothstep(halfW * 0.2, halfW + 380.0, d);

    // melted letters: drift along a slow noise field and run together (blur, then a threshold)
    vec2 q = p / 300.0 + vec2(t * 0.15, t * 0.4);
    vec2 warp = vec2(fbm(q) - 0.5, fbm(q + 7.3) - 0.5 + 0.2) * 70.0 * m;
    vec2 uv = (p + warp) / res;
    float raw = texture(text, uv).a;
    float soft = mix(raw, texture(textBlur, uv).a, m);
    float th = mix(0.5, 0.34, m), aw = mix(0.04, 0.06, m);
    float goo = smoothstep(th - aw, th + aw, soft);
    float a = mix(raw, goo, smoothstep(0.0, 0.2, m)) * textIn * fade;
    float shadow = textureLod(text, (p - vec2(0.0, 10.0)) / res, 5.0).a * textIn * fade * (1.0 - m);

    vec2 cuv = (p / res - 0.5) / cam + 0.5;
    vec3 col = mix(texture(plate, cuv).rgb, texture(wall, cuv).rgb, wallpaper);
    col *= 1.0 - 0.22 * shadow;
    col = mix(col, vec3(1.0), a * 0.96);
    fragColor = vec4(col, 1.0);
}
