// The title scene's timeline: where the glass is, what shape it has, how melted the word is and
// where the camera is, as a pure function of time. Every frame is computed from t = 0 again, so a
// frame rendered on its own (a still, a frame of a video) is the same as one played live.
//
// The springs are the desktop's own (tahoe-motion's spring.js: the exact damped oscillator). The
// glass's two springs are softer than the OS tokens, which settle in a fraction of a second, too
// fast to read across a 1900 px title.

import { Spring } from '../../../extensions/tahoe-motion@cachyos-tahoe/spring.js';

const DT = 1 / 240;

/// the beats of the loop, in seconds: in from the montage's last frame, the clearing pass, the
/// logo, the dissolving pass back, out to the montage's first frame
export const SEQ = {
    zoomIn: [0, 1.8],        // the camera zooms in from the plate to the bare wallpaper
    uiOut: [0.15, 1.2],      // bar, dock and widgets fade out as it moves
    textIn: [1.4, 2.0],      // the word fades in, crisp, as the zoom settles
    passA: 1.9,              // the clearing pass sets off, left to right
    passADur: 2.3,           // how long its guide takes to reach "glass"
    passB: 6.2,              // the dissolving pass sets off from "glass", right to left
    passBDur: 1.6,
    passBIn: 0.35,           // the melt eases in as it sets off (no jump on the letters under it)
    zoomOut: [7.2, 9.0],     // the camera zooms back out to the plate as the glass leaves
    uiIn: [7.9, 8.9],        // bar, dock and widgets fade back in
    end: 9.4,                // the plate, still, until the montage takes over
};

/// how far the camera is zoomed into the wallpaper while the title is on
export const CAM_ZOOM = 1.12;

/// the glass follows a guide through this spring: it lags as it sets off, overshoots where it
/// stops and swings back (inertia)
export const FOLLOW = { damping: 0.55, stiffness: 90 };
/// its shape is this springier spring (elasticity): stretched when it speeds up, squashed when it
/// slows down, and it jiggles back to round
export const JELLY = { damping: 0.35, stiffness: 260 };

const clamp01 = x => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// the camera: a gentler curve (peak speed 1.57x the average, against the cubic's 3x)
const easeInOutSine = t => (1 - Math.cos(Math.PI * t)) / 2;
const span = ([a, b], t) => clamp01((t - a) / (b - a));

/// one glide of the glass from `from` to `to` (px), `t` seconds after it sets off: the guide
/// travels an ease in-out path in `dur` seconds; returns the glass's x, its velocity and its
/// stretch (positive: longer along the motion, negative: squashed)
export function glide(t, from, to, dur, { follow = FOLLOW, jelly = JELLY } = {}) {
    const x = new Spring(from, follow);
    const d = new Spring(0, jelly);
    let vPrev = 0;
    for (let k = 0; k * DT < t; k++) {
        x.retarget(from + (to - from) * easeInOut(clamp01((k * DT) / dur)), 1000);
        x.step(DT);
        const v = x.velocity;
        const acc = (v - vPrev) / DT;
        vPrev = v;
        // speed stretches it; acceleration along the motion stretches it more, deceleration
        // squashes it
        const along = acc * (Math.sign(v) || 1);
        d.retarget(Math.max(-0.35, Math.min(0.5, Math.abs(v) / 3200 + along / 26000)), 1);
        d.step(DT);
    }
    return { x: x.value, v: x.velocity, stretch: Math.max(-0.3, Math.min(0.55, d.value)) };
}

/// the state of frame `t`. `cap`: the glass's rest shape over "glass" ({ cx, cy, w, h }, px);
/// `springs`: { follow, jelly } to try other feels (default FOLLOW, JELLY)
export function timeline(t, cap, springs = {}) {
    const s = {
        cam: 1 + (CAM_ZOOM - 1) * (easeInOutSine(span(SEQ.zoomIn, t)) - easeInOutSine(span(SEQ.zoomOut, t))),
        // 1: the bare wallpaper; 0: the plate (the montage's frame, with bar, dock and widgets)
        wallpaper: smooth(SEQ.uiOut[0], SEQ.uiOut[1], t) * (1 - smooth(SEQ.uiIn[0], SEQ.uiIn[1], t)),
        // the plate faded to: the montage's last frame at the start, its first at the end
        plateOut: t > (SEQ.passB + SEQ.zoomOut[0]) / 2,
        textIn: smooth(SEQ.textIn[0], SEQ.textIn[1], t),
        melt: 0, wake: 1, gone: 0, dir: 1,
        cx: cap.cx, cy: cap.cy, w: cap.w, h: cap.h,
        strength: 1, blur: 0, show: t > SEQ.passA && t < SEQ.zoomOut[1],
    };
    let g;
    if (t < SEQ.passB) {
        // the clearing pass: the letters melt under the lens and in its wake, and heal as it lands
        const ta = Math.max(0, t - SEQ.passA);
        g = glide(ta, -cap.w * 1.2, cap.cx, SEQ.passADur, springs);
        s.melt = 1 - smooth(SEQ.passADur + 0.3, SEQ.passADur + 1.3, ta);
        s.wake = 260 * (1 - smooth(SEQ.passADur - 0.3, SEQ.passADur + 0.5, ta)) + 1;
    } else {
        // the dissolving pass: what it has passed is gone
        const tb = t - SEQ.passB;
        g = glide(tb, cap.cx, -cap.w * 1.6, SEQ.passBDur, springs);
        s.melt = smooth(0, SEQ.passBIn, tb);
        s.gone = s.melt;
        s.dir = -1;
    }
    // the shape keeps its area: height = rest height / sqrt(1 + stretch)
    s.cx = g.x;
    s.w = cap.w * (1 + g.stretch);
    s.h = cap.h / Math.sqrt(1 + g.stretch);
    const speed = Math.abs(g.v);
    s.strength = 1 + 0.6 * Math.min(speed / 2500, 1);
    s.blur = 0;   // motion blur comes from the frames (render.py), not from a mip level
    return s;
}
