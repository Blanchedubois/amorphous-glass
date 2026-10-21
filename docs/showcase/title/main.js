// The title scene: "amorphous glass" over the wallpaper, a capsule of the desktop's glass passing
// over it. Two WebGL2 passes (scene.glsl, glass.glsl) driven by timeline.js.
//
// Query parameters:
//   theme=dark|light        the wallpaper and the stand-in plates (default: the viewer's scheme)
//   plateIn=URL, plateOut=URL   the montage's last frame (the loop starts on it) and first frame
//                           (it ends on it); default: the stand-in desktop screenshots
//   t=SECONDS               draw one frame and stop
//   render=1&fps=N          render.py: draw every frame and POST it to /frame/<n>, then /done

import { SEQ, timeline } from './timeline.js';

const Q = new URLSearchParams(location.search);
const THEME = Q.get('theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const W = 1920;
const H = 1080;

const canvas = document.getElementById('title');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
if (!gl)
    throw new Error('WebGL2 is not available');

// --- the word, set in Space Grotesk, and the glass's rest shape over "glass"
await document.fonts.load('600 184px "Space Grotesk"');
const textCanvas = new OffscreenCanvas(W, H);
const tc = textCanvas.getContext('2d');
tc.font = '600 184px "Space Grotesk"';
tc.letterSpacing = '-4px';
const WORD_GAP = 92;   // "amorphous" ends this far before "glass": the capsule must not cut its s
const wAmorphous = tc.measureText('amorphous').width + WORD_GAP;
const wGlass = tc.measureText('glass').width;
const x0 = (W - wAmorphous - wGlass) / 2;
const baseline = H / 2 + 62;
tc.fillStyle = '#fff';
tc.fillText('amorphous', x0, baseline);
tc.fillText('glass', x0 + wAmorphous, baseline);
const blurCanvas = new OffscreenCanvas(W, H);
const bc = blurCanvas.getContext('2d');
bc.filter = 'blur(13px)';
bc.drawImage(textCanvas, 0, 0);
// centred on the word's ink (ascender to descender); the g's descender reaches the refraction band
export const CAP = { cx: x0 + wAmorphous + wGlass / 2, cy: baseline - 44, w: wGlass + 120, h: 270 };

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

function texture(source) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (source)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
}

async function image(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
}

const suffix = THEME === 'light' ? 'l' : 'd';
const [wallImg, plateInImg, plateOutImg, scene, glass] = await Promise.all([
    image(`plates/fold-${suffix}.webp`),
    image(Q.get('plateIn') ?? `plates/desktop-${THEME}.webp`),
    image(Q.get('plateOut') ?? Q.get('plateIn') ?? `plates/desktop-${THEME}.webp`),
    program('scene.glsl'),
    program('glass.glsl'),
]);
const tex = {
    wall: texture(wallImg),
    plateIn: texture(plateInImg),
    plateOut: texture(plateOutImg),
    text: texture(await createImageBitmap(textCanvas)),
    textBlur: texture(await createImageBitmap(blurCanvas)),
    scene: texture(null),
};
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.scene, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function bind(prog, name, unit, t) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.u[name], unit);
}

export function draw(t) {
    const s = timeline(t, CAP);
    gl.viewport(0, 0, W, H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(scene.p);
    bind(scene, 'wall', 0, tex.wall);
    bind(scene, 'plate', 1, s.plateOut ? tex.plateOut : tex.plateIn);
    bind(scene, 'text', 2, tex.text);
    bind(scene, 'textBlur', 3, tex.textBlur);
    gl.uniform2f(scene.u.res, W, H);
    gl.uniform1f(scene.u.t, t);
    gl.uniform1f(scene.u.cam, s.cam);
    gl.uniform1f(scene.u.wallpaper, s.wallpaper);
    gl.uniform1f(scene.u.textIn, s.textIn);
    gl.uniform1f(scene.u.melt, s.melt);
    gl.uniform1f(scene.u.front, s.cx);
    gl.uniform1f(scene.u.halfW, s.w / 2);
    gl.uniform1f(scene.u.wakeLen, s.wake);
    gl.uniform1f(scene.u.gone, s.gone);
    gl.uniform1f(scene.u.dir, s.dir);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.scene);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(glass.p);
    bind(glass, 'scene', 0, tex.scene);
    gl.uniform2f(glass.u.res, W, H);
    gl.uniform4f(glass.u.cap, s.cx, s.cy, s.w, s.h);
    gl.uniform1f(glass.u.blur, s.blur);
    gl.uniform1f(glass.u.strength, s.strength);
    gl.uniform1f(glass.u.show, s.show ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

if (Q.has('render')) {
    // render.py: every frame, in order, POSTed as PNG
    const fps = parseFloat(Q.get('fps') ?? '30');
    const frames = Math.round(SEQ.end * fps);
    for (let n = 0; n < frames; n++) {
        draw(n / fps);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await fetch(`/frame/${n}`, { method: 'POST', body: png });
    }
    await fetch('/done', { method: 'POST' });
} else if (Q.has('t')) {
    draw(parseFloat(Q.get('t')));
    document.title = 'ready';
} else {
    const start = performance.now();
    const loop = () => {
        draw(((performance.now() - start) / 1000) % SEQ.end);
        requestAnimationFrame(loop);
    };
    loop();
}
