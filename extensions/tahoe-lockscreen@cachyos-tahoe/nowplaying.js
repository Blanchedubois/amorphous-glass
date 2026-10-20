// Now Playing on the lock screen (docs/LOCKSCREEN_PLAN.md, Phase 5): the desktop's wide Music
// widget (tahoe-widgets MusicMedium, in its Liquid Glass card with the album-colour swirl), under
// the clock. The widget's modules are exact copies in widgets/ (tools/lockscreen/check-shared.sh).
//
// Rules while locked:
// - it shows only when GNOME would show its own lock screen media card (the player app's
//   "Show on lock screen" switch in Settings > Notifications), and GNOME's card is hidden while
//   it does; on undo GNOME's card is put back by GNOME's own policy check;
// - nothing goes on the network but the cover (widgets/mpris.js: the player's own cover URL, the
//   user's choice), no lyrics; only the previous, play/pause and next buttons react, none takes key focus;
// - the swirl (and the 1 s progress tick) run only while playing, with animations on, the screen
//   not dimming and input in the last 30 s (Mutter 51 has no readable monitor power state, and a
//   screen gone dark is an idle one).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassCard, glassMode, loadBms} from './widgets/glass.js';
import {MusicLarge, MusicMedium} from './widgets/music.js';

// Which Music widget, and how big (logical px; the desktop's sizes are tahoe-widgets SIZES).
// The user chose wide-big (2026-10-20, from docs/lockscreen/shots/np-size-options.png):
//   wide-big     the wide widget drawn 1.5x (cover, buttons and text; lockscreen.css), 534 x 239
//   wide         the wide widget as on the desktop, 356 x 170
//   large        the large widget, cover across the top, 356 x 504
const STYLES = {
    'wide': {cls: MusicMedium, type: 'music-medium', size: [356, 170]},
    'wide-big': {cls: MusicMedium, type: 'music-medium', size: [534, 239], options: {scale: 1.5}, styleClass: 'tahoe-lock-np-big'},
    'large': {cls: MusicLarge, type: 'music-large', size: [356, 504]},
};
export const NOW_PLAYING = {style: 'wide-big'};
const IDLE_STOP = 30;      // s without input before the swirl and the tick hold still

// GNOME's media cards in the unlock dialog's notifications box
function mediaCards(list) {
    return list.get_children().filter(c => c.has_style_class_name?.('media-message'));
}

// whether GNOME's own rules would show this card while locked
function gnomeWouldShow(card) {
    const policy = card._policy;
    return policy ? Boolean(policy.enable && policy.showInLockScreen) : true;
}

export function buildNowPlaying(frame, dialog, onResize) {
    const box = dialog._notificationsBox;
    const list = box?._notificationBox;
    if (!list)
        throw new Error('the unlock notifications box has changed');

    // ---- idle and dimming: the widget's swirl and tick hold still ----
    let idle = false;
    const dimming = () => {
        const shield = Main.screenShield;
        return Boolean(shield?._shortLightbox?.active || shield?._longLightbox?.active);
    };
    const gate = () => !idle && !dimming();

    // ---- the widget in its glass card, on our own layer over the dialog ----
    const layer = new St.Widget({name: 'now-playing-layer', reactive: false, layout_manager: new Clutter.FixedLayout()});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);

    const style = STYLES[NOW_PLAYING.style] ?? STYLES.wide;
    const CARD = style.size;
    const card = new GlassCard(Main.layoutManager.primaryIndex);
    const mode = glassMode();
    card.setMode(mode);
    card.actor.add_style_class_name(`tahoe-widget-${style.type}`);
    if (style.styleClass)
        card.actor.add_style_class_name(style.styleClass);
    card.actor.set_size(...CARD);
    const widget = new style.cls({swirl: {lockScreen: true, gate}, ...style.options});
    widget.setMode(mode);
    card.content.add_child(widget.actor);
    widget.attachCard(card);
    layer.add_child(card.actor);
    card.actor.hide();

    // ---- the 1 s tick (progress, swirl check), only while it is wanted ----
    let tickId = 0;
    const stopTick = () => {
        if (tickId)
            GLib.source_remove(tickId);
        tickId = 0;
    };
    const syncTick = () => {
        widget.tick(GLib.DateTime.new_now_local());
        const want = card.actor.visible && widget.wantsSeconds && gate();
        if (want && !tickId) {
            tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () =>
                frame.guard(() => {
                    widget.tick(GLib.DateTime.new_now_local());
                    if (widget.wantsSeconds && gate() && card.actor.visible)
                        return GLib.SOURCE_CONTINUE;
                    tickId = 0;
                    return GLib.SOURCE_REMOVE;
                }) ?? GLib.SOURCE_REMOVE);
        } else if (!want) {
            stopTick();
        }
    };
    widget.requestTick = () => frame.guard(syncTick);

    frame.addUndo(() => {
        stopTick();
        widget.destroy();
        card.destroy();
    });
    loadBms().then(lib => frame.guard(() => {
        if (card.actor.get_parent())   // not after the dialog went
            card.setGlass(lib);
    })).catch(e => frame.guard(() => {
        console.warn(`tahoe-lockscreen: no Blur My Shell glass for Now Playing (${e}); plain card`);
    }));

    // ---- GNOME's own cards: hidden while ours shows; ours shows only when GNOME's would ----
    // wanted: GNOME would show a media card; suppressed: music mode (musicmode.js) shows the
    // player in its own card instead, so this one steps aside (GNOME's stay hidden either way)
    const known = new Set();
    let wanted = false;
    let suppressed = false;
    const wantedListeners = [];
    const sync = () => {
        const cards = mediaCards(list);
        const show = cards.some(gnomeWouldShow);
        for (const c of cards) {
            if (!known.has(c)) {
                known.add(c);
                // GNOME's card stays hidden while ours or music mode's shows the player
                frame.connect(c, 'notify::visible', () => {
                    if (c.visible && wanted)
                        c.visible = false;
                });
                frame.addUndo(() => {
                    try {
                        c._applyPolicy?.();   // GNOME's own rule decides again
                    } catch {}
                });
            }
            if (show && c.visible)
                c.visible = false;
        }
        const wantedChanged = wanted !== show;
        wanted = show;
        const was = card.actor.visible;
        card.actor.visible = show && !suppressed;
        // music mode decides again (GNOME adds its card a moment after the player appears: without
        // this, music mode could miss that it should be on, 2026-10-20)
        if (wantedChanged)
            wantedListeners.forEach(fn => fn());
        if (was !== card.actor.visible) {
            syncTick();
            onResize?.();
        }
    };
    frame.connect(list, 'child-added', sync);
    frame.connect(list, 'child-removed', sync);

    // ---- idle watches, dimming and animations: re-check the swirl and the tick ----
    const recheck = () => syncTick();
    const shield = Main.screenShield;
    for (const lightbox of [shield?._shortLightbox, shield?._longLightbox]) {
        if (lightbox)
            frame.connect(lightbox, 'notify::active', recheck);
    }
    frame.connect(St.Settings.get(), 'notify::enable-animations', recheck);
    const monitor = global.backend.get_core_idle_monitor();
    let activeId = 0;
    const idleId = monitor.add_idle_watch(IDLE_STOP * 1000, () => frame.guard(() => {
        idle = true;
        recheck();
        activeId ||= monitor.add_user_active_watch(() => frame.guard(() => {
            activeId = 0;
            idle = false;
            recheck();
        }));
    }));
    frame.addUndo(() => {
        monitor.remove_watch(idleId);
        if (activeId)
            monitor.remove_watch(activeId);
    });

    sync();

    frame.addCheck('now playing', () => {
        if (!card.actor.visible)
            return null;
        if (!card.actor.mapped)
            return 'Now Playing is not shown';
        const [w, h] = card.actor.get_transformed_size();
        return w >= CARD[0] - 1 && h >= CARD[1] - 1 ? null : 'Now Playing is cut off';
    });

    return {
        // GNOME would show a media card now (whether or not this card is suppressed)
        get wanted() {
            return wanted;
        },
        // fn() whenever `wanted` changes
        onWantedChanged(fn) {
            wantedListeners.push(fn);
        },
        // music mode: hide this card while it shows the player its own way
        setSuppressed(value) {
            if (suppressed === value)
                return;
            suppressed = value;
            sync();
        },
        // the swirl's and the ticks' gate: not idle, not dimming (music mode uses it too)
        gate,
        // the space Now Playing takes under the clock (0 when it is not shown)
        get height() {
            return card.actor.visible ? CARD[1] : 0;
        },
        // centred on the monitor, its top y px below the monitor's top
        place(monitorBox, y) {
            const x = Math.round(monitorBox.x + (monitorBox.width - CARD[0]) / 2);
            card.actor.set_position(x, Math.round(monitorBox.y + y));
        },
        get widget() {
            return widget;
        },
        get card() {
            return card;
        },
    };
}
