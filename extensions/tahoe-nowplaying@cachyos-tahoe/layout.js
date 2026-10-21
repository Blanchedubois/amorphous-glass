// The Now Playing layout (docs/NOWPLAYING_PLAN.md §1 "Layout: everything centred"), pure: every
// part's box on one monitor, from the monitor and the blend between the two layouts (1: the cover
// column and the lyrics as one group centred on the screen; 0: the column alone, centred). Sizes
// are logical px at 2560x1440 (the mockups') and scale with the monitor (unitFor).

// the clock: the lock screen's proportions (tahoe-lockscreen layout.js, measured on Apple's press
// image): the date's type DATE_RATIO of the time's, a GAP_RATIO gap under the date's letters
const CLOCK = {
    timeSize: 150,          // the time's type size (its digits 0.730 of it)
    dateTop: 62,            // the top of the date's letters
    DIGITS_EM: 0.730,
    DATE_RATIO: 0.1825,
    GAP_RATIO: 0.0827,
    CAP_HEIGHT: 0.741,
};

export const SIZES = {
    column: 560,            // the cover and everything under it
    gap: 200,               // between the column and the lyrics
    lyrics: 1000,           // the lyrics column
    cover: 560,
    coverRadius: 12,
    lyricSize: 72,          // the sung line's type size (the others at LINE_SCALE)
    lyricBelowCover: 70,    // the sung line's middle, below the cover's middle
    chevron: [112, 52],
    chevronBottom: 34,
    air: 40,                // the least room between the clock, the column and the chevron
    lyricsShift: 120,       // how far the lyrics drift right as they leave
};

// the column from the top: [part, its height, the gap above it]
const COLUMN = [
    ['cover', 560, 0],
    ['title', 50, 40],
    ['artist', 42, 4],
    ['progress', 8, 30],
    ['times', 25, 12],
    ['transport', 112, 18],
    ['volume', 40, 22],
];
export const COLUMN_HEIGHT = COLUMN.reduce((h, [, height, gap]) => h + height + gap, 0);

// logical px per mockup px on this monitor: by its height, unless it is narrow for the group
export function unitFor(monitor) {
    return Math.max(0.4, Math.min(monitor.height / 1440, monitor.width / 1920));
}

const lerp = (a, b, t) => a + (b - a) * t;

export function clockGeometry(monitor, u = unitFor(monitor)) {
    const timeSize = Math.round(CLOCK.timeSize * u);
    const dateSize = Math.round(timeSize * CLOCK.DATE_RATIO);
    const dateTop = monitor.y + Math.round(CLOCK.dateTop * u);
    const digitsTop = dateTop + Math.round(dateSize * CLOCK.CAP_HEIGHT) + Math.round(timeSize * CLOCK.GAP_RATIO);
    const bottom = digitsTop + Math.round(timeSize * CLOCK.DIGITS_EM);
    return {timeSize, dateSize, dateTop, digitsTop, bottom, left: monitor.x, width: monitor.width};
}

// every part's box ({x, y, width, height}, stage px) at this blend; plus the lyrics' opacity
// (0..1) and drift, and the sung line's middle
export function geometry(monitor, blend) {
    const u = unitFor(monitor);
    const S = Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, Array.isArray(v) ? v.map(x => x * u) : v * u]));
    const clock = clockGeometry(monitor, u);

    const [cw, ch] = S.chevron;
    const chevron = {
        x: Math.round(monitor.x + (monitor.width - cw) / 2),
        y: Math.round(monitor.y + monitor.height - S.chevronBottom - ch),
        width: Math.round(cw), height: Math.round(ch),
    };

    // the column, centred between the clock and the chevron; shrunk if it does not fit
    const top = clock.bottom + S.air;
    const room = chevron.y - S.air - top;
    const k = Math.min(1, room / (COLUMN_HEIGHT * u));
    const columnHeight = COLUMN_HEIGHT * u * k;
    const columnTop = top + (room - columnHeight) / 2;
    const centreX = monitor.x + monitor.width / 2;
    const groupLeft = centreX - (S.column + S.gap + S.lyrics) / 2;
    const columnX = lerp(centreX - S.column / 2, groupLeft, blend);

    const boxes = {chevron};
    let y = columnTop;
    for (const [name, height, gap] of COLUMN) {
        y += gap * u * k;
        const h = height * u * k;
        const w = name === 'cover' ? S.cover * k : S.column;
        boxes[name] = {
            x: Math.round(columnX + (S.column - w) / 2), y: Math.round(y),
            width: Math.round(w), height: Math.round(h),
        };
        y += h;
    }
    const cover = boxes.cover;
    const lyricsLeft = groupLeft + S.column + S.gap;
    boxes.lyrics = {
        x: Math.round(lyricsLeft + (1 - blend) * S.lyricsShift), y: Math.round(top),
        width: Math.round(S.lyrics), height: Math.round(room),
    };
    return {
        u, k, clock, boxes,
        coverRadius: Math.round(S.coverRadius * k),
        lyricSize: Math.round(S.lyricSize),
        // the lyrics leave before the column has moved far, and come back after it
        lyricsOpacity: Math.max(0, (blend - 0.5) / 0.5) ** 1.5,
        sungMiddle: Math.round(cover.y + cover.height / 2 + S.lyricBelowCover),
        // the group's middle: the screen's (two columns), or the column's (centred)
        groupMiddle: blend > 0.5 ? (columnX + lyricsLeft + S.lyrics) / 2 : columnX + S.column / 2,
        centreX,
    };
}
