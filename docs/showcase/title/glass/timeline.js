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
    fall: 0.42,            // the fall, accelerating; it lands at 1.12 and bounces (0.4 s)
    morph: 1.6,            // the spread into a bar begins
    rise: 1.78,            // the letters start to rise out of it, from the middle
    fadeOut: [3.85, 4.45], // the glass fades out
    uiIn: [3.85, 4.45],    // bar, dock and widgets fade back in
    end: 5.1,              // the montage's first frame, still, until it cuts in
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
/// the landing itself: the drop bounces off the line (the user, phase 5: "there should be
/// bounce"): it leaves the line with this share of its speed, flies up under the same gravity
/// as the fall, comes back and squashes again, twice, before it settles
export const BOUNCE = 0.35;
/// the drop's diameter, as a fraction of the circle with the word's ink area ("make the drop
/// smaller and expand out": the bar it spreads into keeps the word's volume, not the drop's)
export const DROP_SIZE = 0.6;
/// the spread and the rise: the first title's "follow" spring (../timeline.js FOLLOW), softer
/// than the OS tokens, which settle in a fraction of a second, too fast to read across a 1500 px
/// word; under-damped, so the bar overshoots its length and swings back (inertia)
export const SPREAD = { damping: 0.38, stiffness: 60 };
/// the rise: the same damping, a third of the stiffness: the front crosses the word in about
/// half a second (at 90 the word was whole 0.2 s after the bar, too quick to read as rising)
export const MORPH = { damping: 0.4, stiffness: 25 };
const BAR_H = 95;         // px: the bar's height at the word's length (it expands out of the small drop)
const BAND = 420;         // px: how wide the rise is at any moment

const clamp01 = x => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

/// the state of frame `t`. `word`: { cx, cy, w, h, d } (px): the word's ink box and the drop's
/// diameter (its area is the word's ink area)
export function timeline(t, word, { spreadW = SPREAD_W, spreadH = SPREAD_H, spread = SPREAD, morph = MORPH } = {}) {
    const s = {
        wallpaper: smooth(SEQ.uiOut[0], SEQ.uiOut[1], t) * (1 - smooth(SEQ.uiIn[0], SEQ.uiIn[1], t)),
        plateOut: t > (SEQ.morph + SEQ.fadeOut[0]) / 2,
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
    // landed: the width and height on their springs, kicked with the fall's momentum at each
    // contact; between contacts the drop is in the air, stretched along its speed
    const tl = SEQ.drop + SEQ.fall;
    const v0 = g * SEQ.fall;
    const contacts = [tl];
    for (let v = v0 * BOUNCE, at = tl, i = 0; i < 2; i++, v *= BOUNCE) {
        at += (2 * v) / g;
        contacts.push(at);
    }
    const w = new Spring(d, spreadW);
    const h = new Spring(d, spreadH);
    const m = new Spring(0, morph);
    w.retarget(d, d);
    h.retarget(d, d);
    let spreading = false, rising = false, next = 0, airborne = 0;
    for (let k = 0; tl + k * DT < t; k++) {
        const now = tl + k * DT;
        if (next < contacts.length && now >= contacts[next]) {
            // a contact: the width springs out, the height squashes, with the arriving speed
            const v = v0 * BOUNCE ** next;
            w.velocity += v * LAND_W;
            h.velocity += v * LAND_H;
            w.settled = h.settled = false;
            next++;
        }
        if (!spreading && now >= SEQ.morph) {
            // the spread: the body expands out into a bar the word's length, the velocity kept
            spreading = true;
            w.setToken(spread);
            w.retarget(word.w + 60, word.w);
        }
        // the bar's height chases its area over its length: the area grows from the drop's to
        // the bar's as it expands out, so it thins as it overshoots and thickens as it swings back
        if (spreading) {
            const p = clamp01((w.value - d) / (word.w + 60 - d));
            h.retarget((d * d + (BAR_H * (word.w + 60) - d * d) * p) / Math.max(w.value, 1), d);
        }
        if (!rising && now >= SEQ.rise) {
            rising = true;
            m.retarget(1, 1);
        }
        w.step(DT);
        h.step(DT);
        m.step(DT);
    }
    // in the air between contacts: up with the bounce's speed, back under gravity
    let cy = word.cy, st = 0;
    if (next >= 1 && next <= 2) {
        const v = v0 * BOUNCE ** next;
        const tau = t - contacts[next - 1];
        cy = word.cy - v * tau + (g * tau * tau) / 2;
        st = stretched(v - g * tau);
    }
    s.cy = Math.min(cy, word.cy);
    s.w = Math.max(10, w.value) / Math.sqrt(1 + st);
    s.h = Math.max(10, h.value) * Math.sqrt(1 + st);
    s.morph = 1;
    // the front starts a band before the middle (nothing has risen) and ends a band past the end
    s.front = m.value * (word.w / 2 + 2 * BAND) - BAND;
    return s;
}
