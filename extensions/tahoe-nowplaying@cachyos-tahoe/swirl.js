// The album-colour swirl over the blurred wallpaper (docs/NOWPLAYING_PLAN.md, "The swirl"): the
// lock screen's background swirl (shared/bgswirl.js) as an effect on the wallpaper layer, after its
// blur, so `amount` 0 is the blurred wallpaper (no cover) and 1 the cover's swirl.
// - A cover comes or goes: the amount fades over FADE s.
// - A new cover while one shows: its four colours cross-fade from the old ones over FADE s, in
//   Oklab (palette.js), sent to the shader as uniforms; no second pass.
// - The field turns slowly while it shows and GNOME animations are on: on the frame clock while
//   something else animates, else IDLE_FPS (motion.js). With the amount at 0 the effect is off
//   (no offscreen pass) and nothing ticks.

import {BackgroundSwirl} from './shared/bgswirl.js';
import {labToRgb, rgbToLab} from './shared/palette.js';
import {smoothstep} from './shared/spring.js';
import {Motion} from './motion.js';

const FADE = 1.2;     // s, the widgets' cross-fade (swirl.js FADE)
const SPEED = 1.0;    // the swirl's clock against real time (swirl.js SPEED)

export class Swirl {
    // actor: the blurred wallpaper layer; motion: the view's Motion
    constructor(actor, motion) {
        this._motion = motion;
        this.effect = new BackgroundSwirl();
        this.effect.enabled = false;
        actor.add_effect_with_name('swirl', this.effect);
        this._amount = 0;
        this._target = 0;
        this._palette = null;      // the colours shown (sRGB 0..1)
        this._fadeFrom = null;
        this._fadeTo = null;
        this._fadeAt = 1;
    }

    get amount() {
        return this._amount;
    }

    get colours() {
        return this.effect.colours;
    }

    get t() {
        return this.effect.floats.lm_t;
    }

    // the cover's palette (four sRGB colours), or null: the blurred wallpaper alone
    setPalette(palette) {
        if (palette && this._amount > 0 && this._palette) {
            // a new cover over an old one: cross-fade the colours
            this._fadeFrom = this.effect.colours.map(rgbToLab);
            this._fadeTo = palette.map(rgbToLab);
            this._fadeAt = 0;
            this._motion.task(dt => this._stepColours(dt));
        } else if (palette) {
            this.effect.colours = palette;
            this._fadeAt = 1;
        }
        if (palette)
            this._palette = palette;
        this._target = palette ? 1 : 0;
        if (this._amount !== this._target)
            this._motion.task(dt => this._stepAmount(dt));
        this._paint();
    }

    _stepColours(dt) {
        this._fadeAt = Math.min(1, this._fadeAt + (Motion.animating ? dt / FADE : 1));
        const k = smoothstep(0, 1, this._fadeAt);
        this.effect.colours = this._fadeFrom.map((a, i) =>
            labToRgb(a.map((v, j) => v + (this._fadeTo[i][j] - v) * k)));
        this._paint();
        return this._fadeAt < 1;
    }

    _stepAmount(dt) {
        const step = Motion.animating ? dt / FADE : 1;
        this._amount = this._target > this._amount
            ? Math.min(this._target, this._amount + step)
            : Math.max(this._target, this._amount - step);
        this._paint();
        return this._amount !== this._target;
    }

    _paint() {
        const e = this.effect;
        e.floats.lm_amount = smoothstep(0, 1, this._amount);
        e.enabled = this._amount > 0;
        e.queue_repaint();
        // the field turns only while it shows and animations are on
        const moving = this._amount > 0 && Motion.animating;
        if (moving !== this._moving) {
            this._moving = moving;
            this._motion.setIdle(moving ? dt => this._turn(dt) : null);
        }
    }

    _turn(dt) {
        this.effect.floats.lm_t = (this.effect.floats.lm_t + dt * SPEED) % 10000;
        this.effect.queue_repaint();
    }
}
