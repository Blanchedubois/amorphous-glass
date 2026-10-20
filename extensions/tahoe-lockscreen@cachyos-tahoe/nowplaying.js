// Now Playing on the lock screen (docs/LOCKSCREEN_PLAN.md, Phase 5): the desktop's wide Music
// widget (tahoe-widgets MusicMedium, in its Liquid Glass card with the album-colour swirl), under
// the clock. The widget's modules are exact copies in widgets/ (tools/lockscreen/check-shared.sh).
//
// Rules while locked:
// - it shows only when GNOME would show its own lock screen media card (the player app's
//   "Show on lock screen" switch in Settings > Notifications), and GNOME's card is hidden while
//   it does; on undo GNOME's card is put back by GNOME's own policy check;
// - nothing goes on the network (widgets/mpris.js refuses while locked): local covers only, no
//   lyrics; only the previous, play/pause and next buttons react, none takes key focus;
// - the swirl (and the 1 s progress tick) run only while playing, with animations on, the screen
//   not dimming and input in the last 30 s (Mutter 51 has no readable monitor power state, and a
//   screen gone dark is an idle one).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassCard, glassMode, loadBms} from './widgets/glass.js';
import {MusicMedium} from './widgets/music.js';

const CARD = [356, 170];   // tahoe-widgets SIZES.medium, logical px
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

    const card = new GlassCard(Main.layoutManager.primaryIndex);
    const mode = glassMode();
    card.setMode(mode);
    card.actor.set_size(...CARD);
    const widget = new MusicMedium({swirl: {lockScreen: true, gate}});
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
    const known = new Set();
    const sync = () => {
        const cards = mediaCards(list);
        const show = cards.some(gnomeWouldShow);
        for (const c of cards) {
            if (!known.has(c)) {
                known.add(c);
                frame.connect(c, 'notify::visible', () => {
                    if (c.visible && card.actor.visible)
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
        const was = card.actor.visible;
        card.actor.visible = show;
        if (was !== show) {
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
