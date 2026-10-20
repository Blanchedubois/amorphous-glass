// Lock screen motion (docs/LOCKSCREEN_PLAN.md, Phase 6): the glass clock and Now Playing ease in
// whenever the lock screen appears or the screen wakes from dimming, as the iPhone's clock does.
//
// Only our own actors move. GNOME's dialog, its prompt and its unlock slide are untouched, and a
// wrong password keeps GNOME's own shake. The springs are tahoe-motion's Material 3 Expressive
// tokens (tahoe-motion@cachyos-tahoe/spring.js), copied as numbers so the lock screen does not
// depend on that extension: the grow on the spatial slow spring, the fade on the effects default.
// With animations off (or reduced motion) nothing moves.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SPATIAL = {damping: 0.8, stiffness: 200};   // EXPRESSIVE.spatial.slow
const EFFECTS = {damping: 1, stiffness: 1600};    // EXPRESSIVE.effects.default
const GROW_FROM = 0.97;
const STAGGER = 0.07;     // s between the clock and Now Playing
const DURATION = 900;     // ms, long enough for both springs to settle

const MOVING = ['tahoe-lock:glass-area', 'tahoe-lock:clock-area', 'tahoe-lock:now-playing-layer'];

// a unit step response of a spring (mass 1), 0 at t = 0 to 1 at rest
function spring({damping: zeta, stiffness}, t) {
    if (t <= 0)
        return 0;
    const w = Math.sqrt(stiffness);
    if (zeta >= 1)
        return 1 - Math.exp(-w * t) * (1 + w * t);
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta / Math.sqrt(1 - zeta * zeta) * Math.sin(wd * t));
}

export function buildMotion(frame, dialog) {
    let timeline = null;
    const actors = () => dialog.get_children().filter(c => MOVING.includes(c.name));

    const settle = list => {
        for (const a of list) {
            a.opacity = 255;
            a.set_scale(1, 1);
        }
    };

    const entrance = () => {
        timeline?.stop();
        timeline = null;
        const list = actors();
        if (!St.Settings.get().enable_animations || list.length === 0) {
            settle(list);
            return;
        }
        for (const a of list) {
            a.set_pivot_point(0.5, 0.3);
            a.opacity = 0;
            a.set_scale(GROW_FROM, GROW_FROM);
        }
        timeline = new Clutter.Timeline({actor: dialog, duration: DURATION});
        timeline.connect('new-frame', (tl, ms) => frame.guard(() => {
            const t = ms / 1000;
            list.forEach((a, i) => {
                // the clock (glass and its fallback) together, Now Playing a beat later
                const ti = t - (a.name === 'tahoe-lock:now-playing-layer' ? STAGGER : 0);
                const s = GROW_FROM + (1 - GROW_FROM) * spring(SPATIAL, ti);
                a.set_scale(s, s);
                a.opacity = Math.round(255 * Math.min(1, spring(EFFECTS, ti)));
            });
        }));
        timeline.connect('stopped', () => settle(list));
        timeline.start();
    };

    frame.addUndo(() => {
        timeline?.stop();
        timeline = null;
    });

    // when the dialog first shows, and each time the screen comes back from dimming
    frame.connect(dialog, 'notify::mapped', () => {
        if (dialog.mapped)
            entrance();
    });
    const shield = Main.screenShield;
    for (const lightbox of [shield?._shortLightbox, shield?._longLightbox]) {
        if (lightbox) {
            frame.connect(lightbox, 'notify::active', () => {
                if (!lightbox.active)
                    entrance();
            });
        }
    }
    if (dialog.mapped)
        entrance();
}
