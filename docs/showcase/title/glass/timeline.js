// The glass title's timeline: how present and how soft the glass word is, and whether the plate
// shows, as a pure function of time. A still is the same as a frame of the video.
//
// The word comes in out of a blur and sharpens as it fades in, holds, and goes out the same
// way (the user, 2026-10-22: "just do a blur in and out"; the Now Playing cover's enter, which
// sharpens out of a Gaussian blur as it fades in, tahoe-nowplaying view.js ART_BLUR / ART_FADE_MS).
// The earlier drop (a falling drop of glass that the letters grew out of) is in git history.

/// the beats, in seconds
export const SEQ = {
    // the montage's last frame holds 0.3 s first: loop.sh's 0.5 s dissolve lands on it
    uiOut: [0.3, 0.8],     // bar, dock and widgets fade out: the bare wallpaper
    glassIn: [0.6, 1.5],   // the word sharpens out of the blur, fading in over the first part
    glassOut: [3.3, 4.0],  // it softens back into a blur and fades
    uiIn: [3.5, 4.1],      // bar, dock and widgets fade back in
    end: 4.7,              // the montage's first frame, still, until it cuts in
};

/// px of Gaussian blur the word starts from and ends in (Now Playing: 24 at 1440p)
export const BLUR = 28;

const clamp01 = x => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
// ease out: soft quickly gone (Now Playing's enter)
const easeOut = t => 1 - (1 - t) ** 3;
const span = ([a, b], t) => clamp01((t - a) / (b - a));

/// the state of frame `t`
export function timeline(t) {
    const tin = span(SEQ.glassIn, t);
    const tout = span(SEQ.glassOut, t);
    return {
        wallpaper: smooth(SEQ.uiOut[0], SEQ.uiOut[1], t) * (1 - smooth(SEQ.uiIn[0], SEQ.uiIn[1], t)),
        // the plate faded to: the montage's last frame at the start, its first at the end
        plateOut: t > (SEQ.glassIn[1] + SEQ.glassOut[0]) / 2,
        // the fade leads the sharpening: opaque at 70 % of the way in; the reverse going out
        fade: Math.min(1, tin / 0.7) * (1 - clamp01((tout - 0.3) / 0.7)),
        blur: BLUR * (1 - easeOut(tin)) + BLUR * (1 - easeOut(1 - tout)),
    };
}
