#version 300 es
// Pass 2 of the glass title: the frost. The lock screen's clock shows the picture through a
// Shell.BlurEffect of radius 18; here a separable Gaussian at half resolution, run twice (dir).
precision highp float;

uniform sampler2D src;
uniform vec2 dir;       // (1, 0) then (0, 1), in src px
uniform float sigma;    // px of `src` at `lod`
uniform int lod;        // the mip level to read (1: the full-res scene read at half res)

out vec4 fragColor;

void main() {
    vec2 size = vec2(textureSize(src, lod));
    vec2 uv = gl_FragCoord.xy / size;
    vec2 step = dir / size;
    int radius = int(ceil(sigma * 3.0));
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = -radius; i <= radius; i++) {
        float w = exp(-0.5 * float(i * i) / (sigma * sigma));
        acc += textureLod(src, uv + step * float(i), float(lod)).rgb * w;
        wsum += w;
    }
    fragColor = vec4(acc / wsum, 1.0);
}
