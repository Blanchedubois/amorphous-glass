// Animated icons, a workshop prototype (docs/gnome-tahoe/animated-icons-workshop.md): when Wi-Fi
// turns off or on, its icon draws itself into the new state instead of being swapped. The motion
// follows line-md (github.com/cyberalien/line-md, MIT): a slash drawn along its length (line-md's
// stroke-dashoffset animation), cutting a gap in the glyph as it goes (line-md's mask), and, when
// it turns on, the slash drawn back and the arcs lit one after another from the dot.
//
// GNOME 51's St.Icon draws an SVG as a still (librsvg, no animation), so nothing is vendored: a
// copy of the theme's own icon is laid over the real one and a small shader adds the slash, the
// gap and the ripple. It takes the icon's own colour (light or dark), and once the shell has
// swapped in the new icon the copy fades into it and is removed, so a resting icon costs nothing.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { EXPRESSIVE, Spring } from './spring.js';

// in the icon's own square, 0..1, top left first
const DECLARATIONS = `
uniform float slash;
uniform float front;
uniform float dim;
uniform vec4 line;
uniform vec4 widths;
uniform vec2 center;
uniform vec4 ink;

float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * h);
}`;

// widths: half the slash, half the gap, one pixel, the softness of the ripple's front
const CODE = `
vec2 uv = cogl_tex_coord0_in.xy;
vec4 c = cogl_color_out;
float r = length(uv - center);
c *= mix(1.0, dim, smoothstep(front - widths.w, front + widths.w, r));
if (slash > 0.001) {
    float d = segment(uv, line.xy, mix(line.xy, line.zw, slash));
    c *= clamp((d - widths.y) / widths.z + 0.5, 0.0, 1.0);
    float a = clamp((widths.x - d) / widths.z + 0.5, 0.0, 1.0);
    c = c * (1.0 - a) + ink * a;
}
cogl_color_out = c;`;

const GlyphShader = GObject.registerClass(
class GlyphShader extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, '');
        snippet.set_post(CODE);
        return snippet;
    }

    pose({ slash, front, dim }) {
        this.set_uniform_float('slash', 1, [slash]);
        this.set_uniform_float('front', 1, [front]);
        this.set_uniform_float('dim', 1, [dim]);
        this.queue_repaint();
    }
});

/// What one toggle's icon does. Wi-Fi only for now; Bluetooth, Night Light, Do Not Disturb and
/// mute are the same slash on their own glyphs (see the workshop doc).
export const WIFI = {
    name: 'wifi',
    matches: button => {
        for (let a = button; a; a = a.get_parent()) {
            if (a.constructor.name === 'NMWirelessToggle')
                return true;
        }
        return false;
    },
    // the glyph whose arcs light up when it turns on (whatever the signal, it reads as "on")
    onIcon: 'network-wireless-signal-excellent-symbolic',
    isOff: name => /-disabled-/.test(name ?? ''),
    // line-md's slash on a 24 px grid (2 px wide, top left to bottom right), its gap a little
    // narrower than line-md's so the arcs keep their shape at 28 px; the ripple starts at the dot
    // (bottom centre) and passes the outer arc
    line: [0.2, 0.17, 0.82, 0.8],
    widths: [0.042, 0.085],
    center: [0.5, 0.82],
    reach: 0.78,
};

const HOLD_MS = 2500;

/// One run of a glyph's morph, from one state to the other, on the icon's own frame clock.
export class GlyphMorph {
    constructor(icon, spec, off, { preview = false } = {}) {
        this.icon = icon;
        this.spec = spec;
        this.off = off;
        this.preview = preview;

        // the copy: the real icon's class (its size, and its colour on or off) without the
        // disc around the glyph, laid exactly over the glyph, so the shader's square is the glyph's
        const gicon = off ? icon.gicon : null;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const size = Math.round((icon.get_children()[0]?.width || 16 * scale) / scale);
        this.copy = new St.Icon({
            style_class: icon.style_class,
            style: `padding: 0; margin: 0; border: none; background: none; box-shadow: none; icon-size: ${size}px;`,
            ...(gicon ? { gicon } : { icon_name: spec.onIcon }),
        });
        this.shader = new GlyphShader();
        this.copy.add_effect(this.shader);
        icon.add_child(this.copy);
        this.place();
        this.hideReal();
        icon.connectObject('child-added', (_, child) => child !== this.copy && this.hideReal(), this);

        this.slash = new Spring(off ? 0 : 1, EXPRESSIVE.effects.slow);
        this.front = new Spring(off ? 2 : 0, EXPRESSIVE.spatial.default);
        this.dim = new Spring(1, EXPRESSIVE.effects.default);
        this.fade = new Spring(0, EXPRESSIVE.effects.fast);
        this.front.settled = this.dim.settled = this.fade.settled = true;
        if (off) {
            this.slash.retarget(1);
        } else {
            // the slash draws back while the arcs dim, then they light from the dot outwards
            this.slash.setToken(EXPRESSIVE.effects.default);
            this.slash.retarget(0);
            this.dim.retarget(0.28, 0.72);
        }
        this.since = 0;
        this.colour();
        this.run();
    }

    hideReal() {
        for (const child of this.icon.get_children()) {
            if (child !== this.copy)
                child.opacity = this.handing ? Math.round(255 * this.fade.value) : 0;
        }
        this.icon.set_child_above_sibling(this.copy, null);
    }

    colour() {
        const node = this.copy.peek_theme_node() ?? this.icon.peek_theme_node();
        if (!node)
            return;
        const c = node.get_foreground_color();
        const a = c.alpha / 255;
        this.shader.set_uniform_float('ink', 4, [c.red / 255 * a, c.green / 255 * a, c.blue / 255 * a, a]);
        const s = this.spec;
        const px = 1 / Math.max(8, this.realGlyph()?.width || 16);
        this.shader.set_uniform_float('line', 4, s.line);
        this.shader.set_uniform_float('widths', 4, [s.widths[0], s.widths[1], px, 0.06]);
        this.shader.set_uniform_float('center', 2, s.center);
    }

    run() {
        this.last = 0;
        this.timeline = new Clutter.Timeline({ actor: this.icon, duration: 8000 });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.connect('completed', () => this.finish());
        this.timeline.start();
    }

    /// the shell has the new state's icon now (or never will: the copy hands over anyway)
    get ready() {
        if (this.preview)
            return this.since > (this.preview.hold ?? 0);
        const name = this.icon.icon_name ?? this.icon.gicon?.to_string?.();
        return this.spec.isOff(name) === this.off || this.since > HOLD_MS;
    }

    frame() {
        const now = this.timeline.get_elapsed_time() / (St.Settings.get().slow_down_factor || 1);
        const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.slash.step(dt);
        this.dim.step(dt);
        this.front.step(dt);
        this.fade.step(dt);
        if (!this.off && this.front.settled && this.front.value === 0 && this.slash.value < 0.25) {
            this.front.retarget(this.spec.reach + 0.12);
            this.dim.retarget(0.28);
        }
        // on: done once the front has passed the outer arc (its settle is out of sight)
        const moving = !this.slash.settled || !this.dim.settled
            || (this.off ? !this.front.settled : this.front.value < this.spec.reach);
        if (!moving)
            this.since += dt * 1000;
        if (!moving && !this.handing && this.ready) {
            this.handing = true;
            this.fade.retarget(1);
        }
        this.place();
        this.colour();
        this.shader.pose({ slash: this.slash.value, front: this.front.value, dim: this.dim.value });
        if (this.handing) {
            this.copy.opacity = Math.round(255 * (1 - this.fade.value));
            this.hideReal();
            if (this.fade.settled)
                this.finish();
        }
    }

    realGlyph() {
        return this.icon.get_children().find(c => c !== this.copy) ?? null;
    }

    /// over the real glyph, at its size (the theme gives the class a minimum size, for its disc)
    place() {
        const real = this.realGlyph();
        if (!real)
            return;
        this.copy.set_position(real.x, real.y);
        this.copy.set_size(real.width, real.height);
    }

    /// stills: a fixed pose, the clock stopped (the test driver only)
    pose(values) {
        this.timeline?.stop();
        this.place();
        this.colour();
        this.shader.pose({ slash: 0, front: 2, dim: 1, ...values });
    }

    finish() {
        if (!this.timeline)
            return;
        this.timeline.stop();
        this.timeline.run_dispose();
        this.timeline = null;
        this.icon.disconnectObject(this);
        this.copy.destroy();
        for (const child of this.icon.get_children())
            child.opacity = 255;
        this.onDone?.();
    }
}

export function morphSpecFor(button) {
    return WIFI.matches(button) ? WIFI : null;
}
