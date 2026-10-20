// The widget column's layout on both screens (the login screen's widgets.js, the lock screen's
// widgetstack.js as an exact copy, tools/lockscreen/shared.list): rows of widgets, small (170 px
// square) or wide (two smalls and the gap, 356 x 170, the desktop's medium), on the left. Rows are
// dropped from the bottom when the monitor is too short for all of them.
// docs/GLASS_CONSISTENCY_PLAN.md Phase E: the layouts the user picks from.

import GLib from 'gi://GLib';

export const SIZE = 170;   // tahoe-widgets SIZES.small, logical px
export const GAP = 16;     // between widgets, as on the desktop grid

export const LAYOUTS = {
    now: [['weather-small'], ['calendar-month']],
    E1: [['weather-medium'], ['calendar-month']],             // the forecast wide, the month
    E2: [['weather-medium'], ['calendar-medium']],            // both wide: the forecast, day + month
    E3: [['weather-small', 'calendar-month'], ['clock-analog', 'clock-quarters']],   // 2 x 2
};

// the test shells try one (TAHOE_WIDGET_LAYOUT=E1|E2|E3)
const LAYOUT = GLib.getenv('TAHOE_WIDGET_LAYOUT') || 'now';

// the rows to show: [[kind, ...], ...]
export function layoutRows() {
    return LAYOUTS[LAYOUT] ?? LAYOUTS.now;
}

export function widthOf(kind) {
    return kind.endsWith('-medium') ? 2 * SIZE + GAP : SIZE;
}

// the column keeps clear of the centre (the music card, the prompt, the rows: at most 42 % of the
// width, centred): its right edge at most this share of the monitor's width, less a gap
const RIGHT_LIMIT = 0.29;

// where each widget goes: rows top to bottom, centred on the monitor's height, from left; the
// whole column scaled down evenly when its widest row would reach the centre (a wide widget on a
// small monitor). [{x, y, visible}] in the rows' order, flattened, and the scale
export function arrange(rows, monitor, left, margin) {
    const widest = Math.max(...rows.map(row => row.reduce((w, kind) => w + widthOf(kind), 0) + (row.length - 1) * GAP));
    const room = monitor.x + RIGHT_LIMIT * monitor.width - GAP - left;
    const k = Math.min(1, room / widest);
    const size = SIZE * k, gap = GAP * k;
    let n = rows.length;
    while (n > 1 && n * size + (n - 1) * gap > monitor.height * (1 - 2 * margin))
        n--;
    let y = monitor.y + (monitor.height - (n * size + (n - 1) * gap)) / 2;
    const spots = [];
    rows.forEach((row, r) => {
        let x = left;
        for (const kind of row) {
            spots.push({x: Math.round(x), y: Math.round(y), visible: r < n});
            x += (widthOf(kind) + GAP) * k;
        }
        if (r < n)
            y += size + gap;
    });
    return {spots, scale: k};
}
