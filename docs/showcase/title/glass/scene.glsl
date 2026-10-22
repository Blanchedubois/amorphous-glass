#version 300 es
// Pass 1 of the glass title: what lies under the glass. The montage's frame (the plate: bar, dock
// and widgets over the wallpaper) at the ends, the bare wallpaper while the title is on.
precision highp float;

uniform sampler2D wall;       // the bare wallpaper
uniform sampler2D plate;      // the montage's frame
uniform vec2 res;
uniform float wallpaper;      // 1: the wallpaper, 0: the plate

out vec4 fragColor;

void main() {
    vec2 uv = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / res;
    fragColor = vec4(mix(texture(plate, uv).rgb, texture(wall, uv).rgb, wallpaper), 1.0);
}
