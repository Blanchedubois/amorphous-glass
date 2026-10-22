// The glass title: "amorphous glass" as liquid glass, formed from a drop that falls in and spreads
// out, over the wallpaper. Three WebGL2 passes (scene.glsl, blur.glsl, glass.glsl) driven by
// timeline.js. The same page modes and query parameters as the first title (../main.js):
//
//   theme=dark|light        the wallpaper and the stand-in plates
//   plateIn=URL, plateOut=URL   the montage's last frame (the clip starts on it) and first frame
//   shadow=0, bright=0.14, milk=0.16, hair=2.5, hairAlpha=0.4   the material's dials
//   spreadW=D,S spreadH=D,S spread=D,S morph=D,S   other springs (timeline.js)
//   morphAt=SECONDS         when the blend into the word begins (SEQ.morph; 99: never)
//   t=SECONDS               draw one frame and stop
//   render=1&fps=N&blur=M&from=S&to=S   render.py: every frame POSTed to /frame/<n>, then /done; M moments
//                           per frame across half its time (motion blur)

import { SEQ, timeline } from './timeline.js';
import { signedDistance } from './sdf.js';

const Q = new URLSearchParams(location.search);
if (Q.has('morphAt'))
    SEQ.morph = parseFloat(Q.get('morphAt'));
const THEME = Q.get('theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const SHADOW = parseFloat(Q.get('shadow') ?? '0');
// the material's dials (glass.glsl): the light, the line
const LOOK = {
    brightness: parseFloat(Q.get('bright') ?? '0.14'),
    milk: parseFloat(Q.get('milk') ?? '0.16'),
    hair: parseFloat(Q.get('hair') ?? '2.5'),
    hairAlpha: parseFloat(Q.get('hairAlpha') ?? '0.40'),
};
const spring = key => {
    const [damping, stiffness] = (Q.get(key) ?? '').split(',').map(Number);
    return stiffness > 0 ? { damping, stiffness } : undefined;
};
const SPRINGS = { spreadW: spring('spreadW'), spreadH: spring('spreadH'), spread: spring('spread'), morph: spring('morph') };
const W = 1920;
const H = 1080;

const canvas = document.getElementById('title');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
if (!gl)
    throw new Error('WebGL2 is not available');
if (!gl.getExtension('OES_texture_float_linear'))
    console.warn('no linear filtering of float textures: the SDF edge may step');

// --- GL
const VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

async function program(url) {
    const source = await (await fetch(url)).text();
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, source]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(`${url}: ${gl.getShaderInfoLog(s)}`);
        gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    const u = new Proxy({}, { get: (cache, k) => (cache[k] ??= gl.getUniformLocation(p, k)) });
    return { p, u };
}

function texture(source, { w = W, h = H, mip = true } = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (source)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mip)
        gl.generateMipmap(gl.TEXTURE_2D);
    return t;
}

function floatTexture(data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}

async function image(url) {
    // fetched, not Image.decode(): under headless Chromium's virtual time the decode never
    // resolved once the page had done the SDF's work first
    const blob = await (await fetch(url)).blob();
    return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// the loads start before the word's distance field is computed (under headless Chromium's
// virtual time they never finished when started after that work)
const suffix = THEME === 'light' ? 'l' : 'd';
const loading = Promise.all([
    image(`../plates/fold-${suffix}.webp`),
    image(Q.get('plateIn') ?? `../plates/desktop-${THEME}.webp`),
    image(Q.get('plateOut') ?? Q.get('plateIn') ?? `../plates/desktop-${THEME}.webp`),
    program('scene.glsl'),
    program('blur.glsl'),
    program('glass.glsl'),
]);

// --- the word, set as the first title set it, and its distance field
await document.fonts.load('600 184px "Space Grotesk"');
const textCanvas = new OffscreenCanvas(W, H);
const tc = textCanvas.getContext('2d', { willReadFrequently: true });
tc.font = '600 184px "Space Grotesk"';
tc.letterSpacing = '-4px';
const WORD_GAP = 46;
const wAmorphous = tc.measureText('amorphous').width + WORD_GAP;
const wGlass = tc.measureText('glass').width;
const x0 = (W - wAmorphous - wGlass) / 2;
const baseline = H / 2 + 62;
tc.fillStyle = '#fff';
tc.fillText('amorphous', x0, baseline);
tc.fillText('glass', x0 + wAmorphous, baseline);
const rgba = tc.getImageData(0, 0, W, H).data;
const alpha = new Uint8Array(W * H);
let minX = W, maxX = 0, minY = H, maxY = 0;
for (let i = 0; i < W * H; i++) {
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] > 127) {
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
}
const [wallImg, plateInImg, plateOutImg, scene, blur, glass] = await loading;
// the distance field after the loads: computed while they were in flight, headless Chromium's
// virtual time never let the images finish
const { sd, area } = signedDistance(alpha, W, H);
/// the word's ink box, and the drop's diameter: a circle of the word's ink area
export const WORD = {
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY,
    d: 2 * Math.sqrt(area / Math.PI),
};

const tex = {
    wall: texture(wallImg),
    plateIn: texture(plateInImg),
    plateOut: texture(plateOutImg),
    sdf: floatTexture(sd),
    scene: texture(null),
    frostA: texture(null, { w: W / 2, h: H / 2, mip: false }),
    frostB: texture(null, { w: W / 2, h: H / 2, mip: false }),
};
function framebuffer(t) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
}
const fbo = { scene: framebuffer(tex.scene), frostA: framebuffer(tex.frostA), frostB: framebuffer(tex.frostB) };

// motion blur: the moments of a frame are added up in a float texture, then shown with a little
// dither (the wallpaper's soft gradients band at 8 bits once encoded)
const hasFloat = gl.getExtension('EXT_color_buffer_float');
const accumTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, accumTex);
gl.texImage2D(gl.TEXTURE_2D, 0, hasFloat ? gl.RGBA16F : gl.RGBA8, W, H, 0, gl.RGBA,
    hasFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
const accumFbo = framebuffer(accumTex);
const present = await program(`data:text/plain,${encodeURIComponent(`#version 300 es
precision highp float;
uniform sampler2D accum;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec3 c = texelFetch(accum, ivec2(gl_FragCoord.xy), 0).rgb;
    fragColor = vec4(c + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`)}`);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function bind(prog, name, unit, t) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.u[name], unit);
}

// the frost: the lock clock's Shell.BlurEffect radius 18, as a Gaussian of sigma 18 px at full
// resolution, run at half
const FROST_SIGMA = 18 / 2;

/// draws the moment `t`, into the canvas or (`gain` < 1) added into the accumulation texture
function drawMoment(t, gain) {
    const s = timeline(t, WORD, SPRINGS);

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.scene);
    gl.useProgram(scene.p);
    bind(scene, 'wall', 0, tex.wall);
    bind(scene, 'plate', 1, s.plateOut ? tex.plateOut : tex.plateIn);
    gl.uniform2f(scene.u.res, W, H);
    gl.uniform1f(scene.u.wallpaper, s.wallpaper);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.scene);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.viewport(0, 0, W / 2, H / 2);
    gl.useProgram(blur.p);
    gl.uniform1f(blur.u.sigma, FROST_SIGMA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.frostA);
    bind(blur, 'src', 0, tex.scene);
    gl.uniform1i(blur.u.lod, 1);
    gl.uniform2f(blur.u.dir, 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.frostB);
    bind(blur, 'src', 0, tex.frostA);
    gl.uniform1i(blur.u.lod, 0);
    gl.uniform2f(blur.u.dir, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.viewport(0, 0, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gain < 1 ? accumFbo : null);
    if (gain < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.useProgram(glass.p);
    gl.uniform1f(glass.u.gain, gain);
    bind(glass, 'scene', 0, tex.scene);
    bind(glass, 'frost', 1, tex.frostB);
    bind(glass, 'sdf', 2, tex.sdf);
    gl.uniform2f(glass.u.res, W, H);
    gl.uniform4f(glass.u.blob, s.cx, s.cy, s.w, s.h);
    gl.uniform1f(glass.u.morph, s.morph);
    gl.uniform1f(glass.u.front, s.front);
    gl.uniform1f(glass.u.band, s.band);
    gl.uniform1f(glass.u.fade, s.fade);
    gl.uniform1f(glass.u.shadow, SHADOW);
    for (const [k, v] of Object.entries(LOOK))
        gl.uniform1f(glass.u[k], v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/// draws frame `t`: `moments` instants spread over `shutter` seconds after it, added up
export function draw(t, moments = 1, shutter = 0) {
    if (moments <= 1) {
        drawMoment(t, 1);
        return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < moments; i++)
        drawMoment(t + (shutter * (i + 0.5)) / moments, 1 / moments);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(present.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumTex);
    gl.uniform1i(present.u.accum, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

if (Q.has('render')) {
    // render.py: every frame, in order, POSTed as PNG
    const fps = parseFloat(Q.get('fps') ?? '60');
    const moments = parseInt(Q.get('blur') ?? '6');
    // from=S&to=S: a part of the clip (a phase's preview)
    const first = Math.round(parseFloat(Q.get('from') ?? '0') * fps);
    const frames = Math.round(parseFloat(Q.get('to') ?? SEQ.end) * fps);
    for (let n = first; n < frames; n++) {
        draw(n / fps, moments, 0.5 / fps);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await fetch(`/frame/${n}`, { method: 'POST', body: png });
    }
    await fetch('/done', { method: 'POST' });
} else if (Q.has('t')) {
    draw(parseFloat(Q.get('t')));
    document.title = 'ready';
    console.log('ready', performance.now() | 0, 'ms', JSON.stringify(WORD));
} else {
    const start = performance.now();
    const loop = () => {
        draw(((performance.now() - start) / 1000) % SEQ.end);
        requestAnimationFrame(loop);
    };
    loop();
}
