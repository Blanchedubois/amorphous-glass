// Album colours for the Music widgets' swirl: the cover's main colours, read once per track
// (k-means in OkLab on a 40 px copy), never per frame. No shell imports, so it runs in plain gjs
// too (tools/widgets-stress/covers.js).

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

const SAMPLE = 40;      // px the cover is read at
const CLUSTERS = 5;
const KEEP = 4;         // colours the swirl uses
const INK_THRESHOLD = 0.70;   // shown lightness over which the text turns dark
// how light each glass mode's own glass is, roughly (the swirl keeps most of it, swirl.js)
const GLASS_LIGHTNESS = {dark: 0.22, milky: 0.36, light: 0.78};
const SWIRL_PULL = 0.38;      // swirl.js PULL: how much of the swirl's own lightness shows
const CACHE_ENTRIES = 32;

// ---- colour spaces: sRGB 0..1 <-> OkLab ----

const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;

export function rgbToLab([r, g, b]) {
    [r, g, b] = [toLinear(r), toLinear(g), toLinear(b)];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

export function labToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const clamp = v => Math.min(1, Math.max(0, toSrgb(v)));
    return [
        clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}

// ---- dominant colours ----

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// k-means in OkLab over the opaque pixels (RGB or RGBA bytes); seeded deterministically
// (the mean, then the point farthest from every centre so far), so a cover always gives the
// same colours. Returns up to KEEP colours as OkLab, the most present and colourful first.
export function dominantColours(bytes, width, height, rowstride, channels) {
    // a 5-bit histogram: few distinct points, weighted by how often they occur
    const bins = new Map();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && bytes[i + 3] < 128)
                continue;
            const key = (bytes[i] >> 3) << 10 | (bytes[i + 1] >> 3) << 5 | bytes[i + 2] >> 3;
            bins.set(key, (bins.get(key) ?? 0) + 1);
        }
    }
    if (bins.size === 0)
        return null;
    const points = [], weights = [];
    for (const [key, n] of bins) {
        const rgb = [key >> 10, key >> 5 & 31, key & 31].map(v => (v * 8 + 4) / 255);
        points.push(rgbToLab(rgb));
        weights.push(n);
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const mean = [0, 1, 2].map(c => points.reduce((s, p, i) => s + p[c] * weights[i], 0) / total);
    const centres = [mean];
    const k = Math.min(CLUSTERS, points.length);
    while (centres.length < k) {
        let best = 0, far = -1;
        points.forEach((p, i) => {
            const d = Math.min(...centres.map(c => dist2(p, c)));
            if (d > far) {
                far = d;
                best = i;
            }
        });
        centres.push([...points[best]]);
    }
    const owner = new Array(points.length).fill(0);
    for (let iter = 0; iter < 12; iter++) {
        points.forEach((p, i) => {
            let bi = 0, bd = Infinity;
            centres.forEach((c, j) => {
                const d = dist2(p, c);
                if (d < bd) {
                    bd = d;
                    bi = j;
                }
            });
            owner[i] = bi;
        });
        const sums = centres.map(() => [0, 0, 0, 0]);
        points.forEach((p, i) => {
            const s = sums[owner[i]], w = weights[i];
            s[0] += p[0] * w;
            s[1] += p[1] * w;
            s[2] += p[2] * w;
            s[3] += w;
        });
        sums.forEach((s, j) => {
            if (s[3] > 0)
                centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
        });
    }
    const size = centres.map(() => 0);
    owner.forEach((o, i) => (size[o] += weights[i]));
    // present and colourful first; a chroma of 0.1 counts as much as a third of the cover more
    return centres
        .map((c, j) => ({c, share: size[j] / total}))
        .filter(x => x.share > 0.01)
        .map(x => ({...x, score: x.share ** 0.7 * (0.35 + 3 * Math.hypot(x.c[1], x.c[2]))}))
        .sort((a, b) => b.score - a.score)
        .slice(0, KEEP)
        .map(x => x.c);
}

// the palette for a cover uri (file://), cached; null when it cannot be read
const cache = new Map();

export function coverPalette(uri) {
    if (!uri)
        return Promise.resolve(null);
    if (cache.has(uri)) {
        const known = cache.get(uri);
        cache.delete(uri);   // most recent last
        cache.set(uri, known);
        return known;
    }
    const promise = new Promise(resolve => {
        const file = Gio.File.new_for_uri(uri);
        file.read_async(0, null, (f, res) => {
            let stream;
            try {
                stream = f.read_finish(res);
            } catch {
                resolve(null);
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, SAMPLE, SAMPLE, false, null, (s, r) => {
                let colours = null;
                try {
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                    colours = dominantColours(pixbuf.read_pixel_bytes().toArray(), pixbuf.get_width(),
                        pixbuf.get_height(), pixbuf.get_rowstride(), pixbuf.get_n_channels());
                } catch {}
                stream.close_async(0, null, null);
                resolve(colours);
            });
        });
    });
    cache.set(uri, promise);
    while (cache.size > CACHE_ENTRIES)
        cache.delete(cache.keys().next().value);
    promise.then(colours => {
        if (colours === null)
            cache.delete(uri);   // tried again next time (a cover still being written)
    });
    return promise;
}

// The palette as the swirl shows it, as 4 sRGB colours: the cover's own colours, the same in
// every glass mode (user, 2026-10-20: "pure album cover colours"). A short palette repeats a
// little lighter and darker so the field still moves; a missing cover gives a neutral grey field.
export function swirlPalette(colours) {
    const lab = colours?.length ? colours : [[0.5, 0, 0], [0.6, 0, 0], [0.42, 0, 0], [0.54, 0, 0]];
    const out = [];
    for (let i = 0; i < KEEP; i++) {
        const [L, a, b] = lab[i % lab.length];
        const shift = i < lab.length ? 0 : (i % 2 ? 0.07 : -0.07);
        out.push(labToRgb([Math.min(1, Math.max(0, L + shift)), a, b]));
    }
    return out;
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Dark text only over a swirl that really shows light: the glass keeps its own lightness under
// the swirl's hue and moves only SWIRL_PULL of the way to the swirl's lightness, so a pale cover
// on dark glass is still a mid grey, where white text (with its scrim) reads better (user,
// 2026-10-20: black text on vaguely light swirls was hard to see). In practice: light glass with a
// light cover.
export function wantsDarkInk(palette, mode = 'dark') {
    const swirl = palette.reduce((s, c) => s + luma(c), 0) / palette.length;
    const glass = GLASS_LIGHTNESS[mode] ?? GLASS_LIGHTNESS.dark;
    return (1 - SWIRL_PULL) * glass + SWIRL_PULL * swirl > INK_THRESHOLD;
}
