// gjs -m covers.js OUTDIR [--palettes]: test covers with very different colours (dark, bright,
// monochrome, two-tone) for the Music swirl; with --palettes, prints the swirl palette of each.
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import System from 'system';

const [out, flag] = ARGV;
const N = 300;
const covers = {
    // near black with a warm figure and gold lettering (like a 90s soul cover)
    dark(cr) {
        cr.setSourceRGB(0.03, 0.03, 0.04); cr.paint();
        const g = new Cairo.RadialGradient(150, 120, 10, 150, 120, 120);
        g.addColorStopRGB(0, 0.62, 0.38, 0.22); g.addColorStopRGB(1, 0.10, 0.06, 0.05);
        cr.setSource(g); cr.arc(150, 130, 95, 0, 2 * Math.PI); cr.fill();
        cr.setSourceRGB(0.95, 0.70, 0.10); cr.rectangle(30, 210, 240, 30); cr.fill();
        cr.setSourceRGB(0.70, 0.20, 0.60); cr.rectangle(150, 250, 90, 12); cr.fill();
    },
    // loud pop cover: yellow field, cyan and hot pink shapes
    bright(cr) {
        cr.setSourceRGB(1.0, 0.86, 0.10); cr.paint();
        cr.setSourceRGB(0.05, 0.80, 0.95); cr.arc(90, 90, 70, 0, 2 * Math.PI); cr.fill();
        cr.setSourceRGB(1.0, 0.18, 0.55); cr.rectangle(150, 150, 130, 130); cr.fill();
        cr.setSourceRGB(1, 1, 1); cr.rectangle(20, 240, 100, 20); cr.fill();
    },
    // black and white photo: grey gradients only
    mono(cr) {
        const g = new Cairo.LinearGradient(0, 0, N, N);
        g.addColorStopRGB(0, 0.85, 0.85, 0.85); g.addColorStopRGB(1, 0.12, 0.12, 0.12);
        cr.setSource(g); cr.paint();
        cr.setSourceRGB(0.4, 0.4, 0.4); cr.arc(180, 120, 60, 0, 2 * Math.PI); cr.fill();
    },
    // deep blue with an orange sun
    blue(cr) {
        const g = new Cairo.LinearGradient(0, 0, 0, N);
        g.addColorStopRGB(0, 0.05, 0.10, 0.40); g.addColorStopRGB(1, 0.20, 0.45, 0.85);
        cr.setSource(g); cr.paint();
        cr.setSourceRGB(1.0, 0.50, 0.15); cr.arc(200, 110, 45, 0, 2 * Math.PI); cr.fill();
    },
};
GLib.mkdir_with_parents(out, 0o755);
for (const [name, draw] of Object.entries(covers)) {
    const surface = new Cairo.ImageSurface(Cairo.Format.RGB24, N, N);
    const cr = new Cairo.Context(surface);
    draw(cr);
    surface.writeToPNG(`${out}/${name}.png`);
    cr.$dispose();
}
if (flag === '--palettes') {
    const ext = GLib.build_filenamev([GLib.path_get_dirname(System.programPath), '..', '..', 'extensions', 'tahoe-widgets@cachyos-tahoe', 'palette.js']);
    const {coverPalette, swirlPalette, wantsDarkInk, labToRgb} = await import(`file://${ext}`);
    const hex = c => `#${c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    for (const name of [...Object.keys(covers), 'missing']) {
        const t = GLib.get_monotonic_time();
        const lab = await coverPalette(name === 'missing' ? null : `file://${out}/${name}.png`);
        const ms = (GLib.get_monotonic_time() - t) / 1000;
        print(`${name.padEnd(8)} ${ms.toFixed(1).padStart(5)} ms  cover: ${(lab ?? []).map(c => hex(labToRgb(c))).join(' ') || '-'}`);
        const pal = swirlPalette(lab);
        print(`         swirl  ${pal.map(hex).join(' ')}  ink ${wantsDarkInk(pal) ? 'dark' : 'white'}`);
    }
}
