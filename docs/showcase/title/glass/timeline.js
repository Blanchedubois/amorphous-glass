// The glass title's timeline: where the drop is and what shape it has, how far it has become the
// word, how present the glass is and whether the plate shows, as a pure function of time. Every
// frame is computed from t = 0 again (the springs are stepped at 240 Hz from the start), so a
// still is the same as a frame of the video.
//
// The springs are the desktop's own (tahoe-motion's spring.js, the exact damped oscillator) with
// the tokens the desktop uses: the fall and the elastic landing are the Now Playing cover's drop
// (tahoe-nowplaying@cachyos-tahoe/view.js, 2bd1046), the morph is Material 3's default spatial
// spring.

import { Spring, EXPRESSIVE } from '../../../../extensions/tahoe-motion@cachyos-tahoe/spring.js';

const DT = 1 / 240;

/// the beats, in seconds
export const SEQ = {
    // the montage's last frame holds 0.3 s first: loop.sh's 0.5 s dissolve lands on it
    uiOut: [0.3, 0.8],     // bar, dock and widgets fade out: the bare wallpaper
    drop: 0.7,             // the drop appears above the line and starts to fall
    dropIn: 0.2,           // fading in as it starts (Now Playing: 0.11; longer, less abrupt)
    fall: 0.42,            // the fall, accelerating; it lands at 1.12
    rise: 1.3,             // the letters start to inflate out of the drop, from the middle
    fadeOut: [3.65, 4.25], // the glass fades out
    uiIn: [3.65, 4.25],    // bar, dock and widgets fade back in
    end: 4.9,              // the montage's first frame, still, until it cuts in
};

// Now Playing's drop (view.js): the stretch along the fall, the volume kept; the landing's springs,
// the width leading with the fall's momentum, the height squashing first
const STRETCH_PER_SPEED = 0.00045;
const MAX_STRETCH = 0.45;
export const SPREAD_W = { damping: 0.62, stiffness: 420 };
export const SPREAD_H = { damping: 0.66, stiffness: 320 };
// the share of the landing speed that goes into the springs. Now Playing gives 0.9 and -0.35 of
// a 72 px drop's speed; the title's drop is 5x bigger and falls 4x farther, so the shares are
// scaled to keep the overshoot a small fraction of the drop (about 10 %: 0.2 read as timid)
export const LAND_W = 0.9 * 0.6;
export const LAND_H = -0.35 * 0.6;
/// the drop's diameter, as a fraction of the circle with the word's ink area ("make the drop
/// smaller and expand out": the bar it spreads into keeps the word's volume, not the drop's)
export const DROP_SIZE = 0.6;
/// the rise: the front crosses the word in about half a second, softer than the OS tokens
/// (which settle in a fraction of a second, too fast to read across a 1500 px word)
export const MORPH = { damping: 0.5, stiffness: 25 };
const BAND = 420;         // px: how wide the rise is at any moment

const clamp01 = x => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

/// the state of frame `t`. `word`: { cx, cy, w, h, d } (px): the word's ink box and the drop's
/// diameter (its area is the word's ink area)
export function timeline(t, word, { spreadW = SPREAD_W, spreadH = SPREAD_H, morph = MORPH } = {}) {
    const s = {
        wallpaper: smooth(SEQ.uiOut[0], SEQ.uiOut[1], t) * (1 - smooth(SEQ.uiIn[0], SEQ.uiIn[1], t)),
        plateOut: t > (SEQ.rise + SEQ.fadeOut[0]) / 2,
        fade: 0, morph: 0, front: -BAND, band: BAND,
        cx: word.cx, cy: word.cy, w: word.d, h: word.d,
    };
    if (t < SEQ.drop)
        return s;
    const d = word.d * DROP_SIZE;
    // the drop appears just above the frame and falls to the word's line
    const from = -d / 2 - 20;
    const fallPx = word.cy - from;
    const g = (2 * fallPx) / (SEQ.fall * SEQ.fall);   // the fall's acceleration, px/s^2
    const stretched = speed => Math.min(MAX_STRETCH, Math.abs(speed) * STRETCH_PER_SPEED);
    s.fade = Math.min(1, (t - SEQ.drop) / SEQ.dropIn) * (1 - smooth(SEQ.fadeOut[0], SEQ.fadeOut[1], t));
    const td = t - SEQ.drop;
    if (td < SEQ.fall) {
        s.cy = word.cy - fallPx * (1 - (td / SEQ.fall) ** 2);
        const st = stretched(g * td);
        s.w = d / Math.sqrt(1 + st);
        s.h = d * Math.sqrt(1 + st);
        return s;
    }
    // landed: the width and height on their springs, with the fall's momentum (one soft squash)
    const tl = SEQ.drop + SEQ.fall;
    const v0 = g * SEQ.fall;
    const w = new Spring(d / Math.sqrt(1 + stretched(v0)), spreadW, { velocity: v0 * LAND_W });
    const h = new Spring(d * Math.sqrt(1 + stretched(v0)), spreadH, { velocity: v0 * LAND_H });
    const m = new Spring(0, morph);
    w.retarget(d, d);
    h.retarget(d, d);
    let rising = false;
    for (let k = 0; tl + k * DT < t; k++) {
        const now = tl + k * DT;
        if (!rising && now >= SEQ.rise) {
            rising = true;
            m.retarget(1, 1);
        }
        // the drop drains into the letters as they inflate: gone when the front is well out
        const drain = 1 - smooth(0.1, 0.7, m.value);
        w.retarget(d * drain, d);
        h.retarget(d * drain, d);
        w.step(DT);
        h.step(DT);
        m.step(DT);
    }
    s.cy = word.cy;
    s.w = Math.max(1, w.value);
    s.h = Math.max(1, h.value);
    s.morph = 1;
    // the front starts a band before the middle (nothing has risen) and ends a band past the end
    s.front = m.value * (word.w / 2 + 2 * BAND) - BAND;
    return s;
}
