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
    uiOut: [0.05, 0.55],   // bar, dock and widgets fade out: the bare wallpaper
    drop: 0.45,            // the drop appears above the line and starts to fall
    dropIn: 0.11,          // fading in as it starts (Now Playing: DROP_IN_MS)
    fall: 0.42,            // the fall, accelerating
    morph: 1.10,           // the blend into the word begins
    fadeOut: [3.4, 4.0],   // the glass fades out
    uiIn: [3.4, 4.0],      // bar, dock and widgets fade back in
    end: 5.6,              // the plate, still, until the montage cuts in
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
export const LAND_W = 0.9 * 0.3;
export const LAND_H = -0.35 * 0.3;
/// the morph's spring: the word fills in, with Material 3's default spatial feel
export const MORPH = EXPRESSIVE.spatial.default;

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
        plateOut: t > (SEQ.morph + SEQ.fadeOut[0]) / 2,
        fade: 0, morph: 0,
        cx: word.cx, cy: word.cy, w: word.d, h: word.d,
    };
    if (t < SEQ.drop)
        return s;
    // the drop appears just above the frame and falls to the word's line
    const from = -word.d / 2 - 20;
    const fallPx = word.cy - from;
    s.fade = Math.min(1, (t - SEQ.drop) / SEQ.dropIn) * (1 - smooth(SEQ.fadeOut[0], SEQ.fadeOut[1], t));
    const td = t - SEQ.drop;
    if (td < SEQ.fall) {
        const k = td / SEQ.fall;
        s.cy = word.cy - fallPx * (1 - k * k);
        const speed = (2 * fallPx * k) / SEQ.fall;
        const st = Math.min(MAX_STRETCH, speed * STRETCH_PER_SPEED);
        s.w = word.d / Math.sqrt(1 + st);
        s.h = word.d * Math.sqrt(1 + st);
        return s;
    }
    // landed: the width and height on their springs, with the fall's momentum
    const speed = (2 * fallPx) / SEQ.fall;
    const st = Math.min(MAX_STRETCH, speed * STRETCH_PER_SPEED);
    const w = new Spring(word.d / Math.sqrt(1 + st), spreadW, { velocity: speed * LAND_W });
    const h = new Spring(word.d * Math.sqrt(1 + st), spreadH, { velocity: speed * LAND_H });
    const m = new Spring(0, morph);
    w.retarget(word.d, word.d);
    h.retarget(word.d, word.d);
    const tl = SEQ.drop + SEQ.fall;
    let spreading = false;
    for (let k = 0; tl + k * DT < t; k++) {
        const now = tl + k * DT;
        if (!spreading && now >= SEQ.morph) {
            // the spread: the same body pulled out to the word's extent, the velocity kept
            spreading = true;
            w.retarget(word.w + 40, word.w);
            h.retarget(word.h + 20, word.d);
            m.retarget(1, 1);
        }
        w.step(DT);
        h.step(DT);
        m.step(DT);
    }
    s.w = Math.max(10, w.value);
    s.h = Math.max(10, h.value);
    s.morph = clamp01(m.value);
    return s;
}
