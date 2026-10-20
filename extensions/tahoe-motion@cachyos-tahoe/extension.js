// Tahoe Motion: Liquid Glass open and close animations for the shell's glass popups.
//
// Cards (menus, calendar, dock and desktop menus, banners, quick settings submenus, GTK app menus)
// open from a glass circle at their origin, the clicked icon or the pointer: it stretches into a
// bar along the card's edge, then drops into the card, and the rows pop in one after the other as
// the edge reaches them. Quick settings opens top to bottom, button after button, each growing
// from a small circle while its icon, labels and slider track arrive one by one. Closing runs the
// other way, faster. The choreography is in morph.js, the rows and parts in items.js.
//
// The glass is drawn by the patched Blur My Shell (config/bms-tahoe-glass.patch): this extension
// drives its reveal shape and freezes its backdrop for the animation, through the
// `globalThis.__tahoeGlass` API. Without that API, with animations off or reduced motion, popups
// open as GNOME opens them. GTK app menus close at once: GNOME destroys their windows before an
// extension hears of it. docs/gnome-tahoe/animations.md, Phases 4 and 5.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { State as TrayState } from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { IconEffects } from './icons.js';
import { animationsOn, ButtonPiece, CardPiece, glassApi, Morph, stageRect } from './morph.js';
import { lerp } from './spring.js';

const BANNER_CIRCLE_PX = 34;
// two origins this close are the same place (the same icon, or the pointer that did not move)
const SAME_ORIGIN_PX = 6;
// a menu left for the next one stays up this many frames, while the next one is laid out
const HANDOVER_FRAMES = 2;

/// what a popup opens from, without asking Clutter for its place on screen: the source actor and
/// its own position (the dummy cursor of a right-click moves; a panel button does not)
function originKey(actor) {
    return actor ? { actor, x: actor.x, y: actor.y } : null;
}

function sameOrigin(a, b) {
    if (!a || !b)
        return false;
    return a.actor === b.actor && Math.abs(a.x - b.x) <= SAME_ORIGIN_PX
        && Math.abs(a.y - b.y) <= SAME_ORIGIN_PX;
}
// quick settings is set up this long after the shell starts
const WARM_MS = 3000;
const APP_MENU_TYPES = [
    Meta.WindowType.DROPDOWN_MENU, Meta.WindowType.POPUP_MENU, Meta.WindowType.MENU, Meta.WindowType.COMBO,
];

export default class TahoeMotion extends Extension {
    enable() {
        this._morphs = new Map();
        const proto = BoxPointer.BoxPointer.prototype;
        this._boxOpen = proto.open;
        this._boxClose = proto.close;
        const motion = this;
        proto.open = function (animate, onComplete) {
            if (!motion.handles(this, animate)) {
                motion.stop(this);
                return motion._boxOpen.call(this, animate, onComplete);
            }
            return motion.open(this, onComplete, motion.sliding(animate));
        };
        proto.close = function (animate, onComplete) {
            if (!this.visible)
                return undefined;
            if (!motion.handles(this, animate)) {
                // a close already waiting (a menu left for the next) has its callback run too
                const waiting = motion.stop(this);
                return motion._boxClose.call(this, animate, waiting ? () => {
                    waiting();
                    onComplete?.();
                } : onComplete);
            }
            return motion.close(this, onComplete, motion.sliding(animate));
        };
        this.patchBanners();
        this.watchAppMenus();
        // quick settings icons bounce on press and replace on toggle (not while the panel moves)
        this._icons = new IconEffects(() => animationsOn() === false
            || this._morphs.has(Main.panel.statusArea.quickSettings?.menu?._boxPointer));
        // the one-time setup of quick settings, done while idle rather than on its first open
        // (23 ms of the first open's frame, measured)
        this._warmId = GLib.timeout_add(GLib.PRIORITY_LOW, WARM_MS, () => {
            this._warmId = 0;
            this.patchSubmenus();
            this._icons?.track(Main.panel.statusArea.quickSettings?.menu);
            return GLib.SOURCE_REMOVE;
        });
    }

    /// GNOME 51 does not export QuickToggleMenu: its prototype comes from a live toggle's menu
    patchSubmenus() {
        if (this._submenuProto)
            return;
        const quickSettings = Main.panel.statusArea.quickSettings?.menu;
        const menu = quickSettings?._grid?.get_children().map(child => child.menu)
            .find(candidate => candidate && candidate !== quickSettings);
        if (!menu)
            return;
        let proto = Object.getPrototypeOf(menu);
        while (proto && !Object.prototype.hasOwnProperty.call(proto, 'open'))
            proto = Object.getPrototypeOf(proto);
        if (!proto)
            return;
        this._submenuProto = proto;
        this._submenuOpen = proto.open;
        this._submenuClose = proto.close;
        const motion = this;
        proto.open = function (params = {}) {
            const opened = motion._submenuOpen.call(this, params);
            if (opened && (params.animate ?? true))
                motion.submenu(this, true);
            return opened;
        };
        proto.close = function (params = {}) {
            const closed = motion._submenuClose.call(this, params);
            if (closed && (params.animate ?? true))
                motion.submenu(this, false);
            return closed;
        };
    }

    /// A quick settings submenu grows out of its toggle: a bar the toggle's width stretches across,
    /// while the submenu's height opens on the same spring (the buttons below slide with it) and
    /// its rows pop in. GNOME's own height and row animations (started just before) are replaced.
    submenu(menu, opening) {
        const quickSettings = Main.panel.statusArea.quickSettings?.menu;
        const root = quickSettings?._boxPointer;
        const api = glassApi();
        if (!root || !api || !animationsOn())
            return;
        const target = menu.box;
        const surface = api.surfaces(root).find(candidate => candidate.target === target);
        if (!surface)
            return;
        const container = menu.actor;
        const previous = this.takeOver(target);
        container.remove_transition('height');
        target.remove_transition('opacity');
        target.opacity = 255;
        const startHeight = container.height;
        container.height = -1;
        const [, fullHeight] = container.get_preferred_height(-1);
        container.height = startHeight;
        const piece = previous.get(target) ?? new CardPiece(surface, {
            fall: false,
            geometry: () => {
                const card = { x: 0, y: 0, width: target.width, height: Math.max(fullHeight, 2) };
                const toggle = stageRect(menu.sourceActor);
                const [ok, tx] = toggle ? target.transform_stage_point(toggle.x, toggle.y) : [false, 0];
                const width = Math.min(toggle?.width ?? card.width, card.width);
                const height = Math.min(toggle?.height ?? 48, card.height);
                const x = ok ? Math.min(Math.max(tx, 0), card.width - width) : 0;
                return {
                    card,
                    circle: { x, y: 0, width, height },
                    circleRadius: height / 2,
                    cardRadius: Math.min(surface.corner_radius, card.width / 2, card.height / 2),
                };
            },
        });
        const morph = new Morph(root, opening, {
            origin: stageRect(menu.sourceActor),
            pieces: [piece],
            fadeRoot: false,
            elastic: false,
            // the submenu is as tall as its glass's poured edge: the buttons below move with it
            step: () => {
                const rect = piece.ready ? piece.lastRect : null;
                container.height = rect ? Math.min(fullHeight, Math.max(0, rect.y + rect.height)) : 0;
            },
            onDone: () => {
                this._morphs.delete(target);
                if (opening) {
                    container.height = -1;
                } else {
                    container.hide();
                    menu.emit('menu-closed');
                }
            },
        });
        this._morphs.set(target, morph);
    }

    /// Notification banners: a glass circle at the top of the banner grows into it; on hide it
    /// shrinks back. GNOME's slide from above is replaced (GNOME 51's own bookkeeping is kept).
    patchBanners() {
        const tray = Main.messageTray;
        const motion = this;
        this._trayShow = tray._updateShowingNotification;
        this._trayHide = tray._hideNotification;
        tray._updateShowingNotification = function () {
            // only a banner coming in; an update of the one on screen keeps GNOME's ease
            const fresh = this._bannerBin.opacity === 0;
            motion._trayShow.call(this);
            if (fresh && animationsOn() && glassApi())
                motion.banner(this, true);
        };
        tray._hideNotification = function (animate) {
            // a banner still coming in stops where it is
            const previous = motion.takeOver(this._bannerBin);
            if (!animate || !motion.bannerMotion(this)) {
                previous.forEach(piece => piece.restore());
                return motion._trayHide.call(this, animate);
            }
            motion._bannerHandover = previous;
            this._notificationFocusGrabber.ungrabFocus();
            this._banner.disconnectObject(this);
            this._resetNotificationLeftTimeout();
            this._bannerBin.remove_all_transitions();
            this._notificationState = TrayState.HIDING;
            motion.banner(this, false);
            return undefined;
        };
    }

    unpatchBanners() {
        const tray = Main.messageTray;
        if (this._trayShow)
            tray._updateShowingNotification = this._trayShow;
        if (this._trayHide)
            tray._hideNotification = this._trayHide;
        this._trayShow = this._trayHide = null;
    }

    bannerMotion(tray) {
        const api = glassApi();
        return animationsOn() && api !== null && api.surfaces(tray._bannerBin).length > 0;
    }

    banner(tray, opening) {
        const bin = tray._bannerBin;
        const previous = this._bannerHandover ?? this.takeOver(bin);
        this._bannerHandover = null;
        bin.remove_all_transitions();
        bin.set({ y: 0, scale_x: 1, scale_y: 1 });
        const rect = stageRect(tray._banner ?? bin);
        const origin = rect && {
            x: rect.x + rect.width / 2 - BANNER_CIRCLE_PX / 2, y: rect.y,
            width: BANNER_CIRCLE_PX, height: BANNER_CIRCLE_PX,
        };
        const pieces = this.piecesOf(bin, previous);
        // its glass is made just after the banner is added: it joins in the first frames
        const lazy = opening ? have => {
            const known = new Set(have.map(piece => piece.target));
            return (glassApi()?.surfaces(bin) ?? [])
                .filter(surface => !known.has(surface.target) && surface.target.mapped)
                .map(surface => new CardPiece(surface));
        } : null;
        const morph = new Morph(bin, opening, {
            origin,
            pieces,
            lazy,
            onDone: () => {
                this._morphs.delete(bin);
                if (opening) {
                    if (!tray._notification)
                        return;
                    tray._notificationState = TrayState.SHOWN;
                    tray._showNotificationCompleted();
                    tray._updateState();
                } else {
                    bin.opacity = 0;
                    bin.y = -bin.height;
                    tray._notificationState = TrayState.HIDDEN;
                    tray._hideNotificationCompleted();
                    tray._updateState();
                }
            },
        });
        this._morphs.set(bin, morph);
    }

    /// GTK app menus, popovers and drop-down lists are popup windows: their glass (Blur My Shell's
    /// app-menu glass, a child of the window actor) grows from a circle at the pointer, pinned to
    /// the menu's edge nearest it, and the window's content rides with it. GNOME maps these
    /// windows without an animation and destroys them at once, before an extension hears of it,
    /// so only the open is animated.
    watchAppMenus() {
        this._mapId = global.window_manager.connect('map', (_, actor) => {
            try {
                this.appMenu(actor);
            } catch (e) {
                console.error(`[tahoe-motion] app menu: ${e}`);
            }
        });
    }

    appMenu(windowActor) {
        const window = windowActor.meta_window;
        if (!APP_MENU_TYPES.includes(window.get_window_type()) || !animationsOn() || !glassApi())
            return;
        // the menus Blur My Shell glasses: a GTK app's own Wayland popups (window_rules.js)
        if (window.get_client_type() !== Meta.WindowClientType.WAYLAND
            || !window.get_transient_for()?.get_gtk_application_id())
            return;
        // from the pointer: the card opens out of the point that was clicked
        const [px, py] = global.get_pointer();
        const origin = { x: px, y: py, width: 0, height: 0 };
        const content = () => windowActor.get_children()
            .filter(child => child !== window.blur_actor);
        // hidden until its glass exists (Blur My Shell makes it right after the map)
        content().forEach(child => (child.opacity = 0));
        const morph = new Morph(windowActor, true, {
            origin,
            pieces: [],
            fadeRoot: false,
            hold: false,
            lazy: have => {
                if (have.length)
                    return [];
                const glass = glassApi()?.app_menu(window);
                return glass ? [new CardPiece({ ...glass, target: windowActor }, { content: content() })] : [];
            },
            onDone: () => {
                this._morphs.delete(windowActor);
                content().forEach(child => (child.opacity = 255));
            },
        });
        this._morphs.set(windowActor, morph);
        windowActor.connectObject('destroy', () => {
            this._morphs.get(windowActor)?.stopTimeline();
            this._morphs.delete(windowActor);
        }, this);
    }

    disable() {
        for (const boxPointer of [...(this._closingSoon ?? [])])
            this.cancelCloseSoon(boxPointer);
        if (this._warmId)
            GLib.source_remove(this._warmId);
        this._warmId = 0;
        this._icons?.destroy();
        this._icons = null;
        if (this._mapId)
            global.window_manager.disconnect(this._mapId);
        this._mapId = 0;
        this.unpatchBanners();
        const proto = BoxPointer.BoxPointer.prototype;
        proto.open = this._boxOpen;
        proto.close = this._boxClose;
        if (this._submenuProto) {
            this._submenuProto.open = this._submenuOpen;
            this._submenuProto.close = this._submenuClose;
            this._submenuProto = null;
        }
        this._morphs.forEach(morph => morph.destroy());
        this._morphs = null;
    }

    closeSoon(boxPointer, onComplete) {
        this.cancelCloseSoon(boxPointer);
        let frames = HANDOVER_FRAMES;
        const laters = global.compositor.get_laters();
        (this._closingSoon ??= new Set()).add(boxPointer);
        boxPointer._tahoeCloseSoonDone = onComplete ?? (() => {});
        boxPointer._tahoeCloseSoon = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (--frames > 0)
                return GLib.SOURCE_CONTINUE;
            delete boxPointer._tahoeCloseSoon;
            delete boxPointer._tahoeCloseSoonDone;
            this._closingSoon.delete(boxPointer);
            this._boxClose.call(boxPointer, BoxPointer.PopupAnimation.NONE, onComplete);
            return GLib.SOURCE_REMOVE;
        });
    }

    /// gives the callback of the close it stops
    cancelCloseSoon(boxPointer) {
        if (!boxPointer._tahoeCloseSoon)
            return null;
        global.compositor.get_laters().remove(boxPointer._tahoeCloseSoon);
        const done = boxPointer._tahoeCloseSoonDone ?? null;
        delete boxPointer._tahoeCloseSoon;
        delete boxPointer._tahoeCloseSoonDone;
        this._closingSoon?.delete(boxPointer);
        return done;
    }

    /// counts for stress tests (tools/headless): animations running, menus waiting to close, icon
    /// effects and the handlers this extension holds
    debug() {
        const icons = this._icons;
        return {
            morphs: this._morphs?.size ?? 0,
            morph_timelines: [...(this._morphs?.values() ?? [])].filter(m => m.timeline).length,
            closing_soon: this._closingSoon?.size ?? 0,
            icon_buttons: icons?.tracked.size ?? 0,
            icon_timelines: [...(icons?.motions.values() ?? [])].filter(m => m.timeline).length
                + [...(icons?.squishes.values() ?? [])].filter(m => m.timeline).length,
        };
    }

    /// GNOME opens and closes with a fade only when the pointer slides from one menu to the next
    sliding(animate) {
        return (animate & BoxPointer.PopupAnimation.FADE) !== 0
            && (animate & BoxPointer.PopupAnimation.SLIDE) === 0;
    }

    handles(boxPointer, animate) {
        const api = glassApi();
        return Boolean(animate) && animationsOn() && api !== null
            && api.surfaces(boxPointer).length > 0;
    }

    isQuickSettings(boxPointer) {
        return boxPointer === Main.panel.statusArea.quickSettings?.menu?._boxPointer;
    }

    /// stops the animation running on `key`, handing its pieces over (target -> piece)
    takeOver(key, origin = null) {
        const running = this._morphs.get(key);
        this._morphs.delete(key);
        if (!running)
            return new Map();
        const pieces = running.interrupt();
        // a menu that was closing counts as closed: opened again somewhere else (a right-click at
        // another place) it starts afresh there; opened again where it was (spamming one menu) it
        // turns round from where its shape is
        if (origin && !running.opening && !sameOrigin(running.originKey, origin)) {
            pieces.forEach(piece => piece.restore());
            running.resetRoot();
            return new Map();
        }
        return new Map(pieces.map(piece => [piece.target, piece]));
    }

    /// GNOME opens or closes a popup at once (menu.close(false): the overview, the lock screen, a
    /// grab lost) in the middle of an animation: the animation ends where it is, the glass at rest
    /// and released (found in the stress test: left running, its glass stayed held)
    stop(boxPointer) {
        const waiting = this.cancelCloseSoon(boxPointer);
        const running = this._morphs.get(boxPointer);
        if (running) {
            this.takeOver(boxPointer).forEach(piece => piece.restore());
            running.resetRoot();
            if (running.fadeRoot)
                boxPointer.opacity = 255;
        }
        return waiting;
    }

    /// the pieces of a popup: those of an interrupted animation as they are, new ones otherwise
    piecesOf(root, previous) {
        const quickSettings = this.isQuickSettings(root);
        const busy = new Set([...this._morphs.keys()]);
        const pieces = (glassApi()?.surfaces(root) ?? [])
            .filter(surface => !busy.has(surface.target)
                && (surface.target.mapped || previous.has(surface.target)))
            .map(surface => previous.get(surface.target)
                ?? (quickSettings ? new ButtonPiece(surface) : new CardPiece(surface)));
        const kept = new Set(pieces);
        previous.forEach(piece => !kept.has(piece) && piece.restore());
        return pieces;
    }

    open(boxPointer, onComplete, quick = false) {
        // slid back before its close: it simply stays
        this.cancelCloseSoon(boxPointer);
        this.patchSubmenus();
        if (this.isQuickSettings(boxPointer))
            this._icons?.track(Main.panel.statusArea.quickSettings.menu);
        // where it opens from is read after GNOME has laid the menu out (frame two): reading an
        // actor's place on screen now would make Clutter lay the stage out early and place the
        // menu at its previous source (found in the right-click test: one click behind)
        const source = boxPointer._sourceActor;
        const origin = () => stageRect(source);
        const previous = this.takeOver(boxPointer, originKey(source));
        boxPointer.remove_all_transitions();
        // (never hide it here to reset it: GNOME has just grabbed input on it, and hiding it drops
        // the grab, after which no click outside closes it: a menu stuck open)
        boxPointer.set({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        boxPointer._muteKeys.enabled = false;
        // it takes clicks at once: GNOME mutes a popup until its (150 ms) animation is over, and
        // with a longer one a click outside it or a right-click elsewhere was swallowed (the menu
        // looked stuck; reproduced with real clicks in the headless shell)
        boxPointer._muteInput.enabled = false;
        boxPointer.show();
        const morph = new Morph(boxPointer, true, {
            origin,
            originKey: originKey(source),
            pieces: this.piecesOf(boxPointer, previous),
            quickSettings: this.isQuickSettings(boxPointer),
            // sliding in from another menu: the pour only partly plays (it starts half poured), and
            // its glass is frozen only once the menu left behind has gone: frozen at once, it kept
            // that menu printed in its backdrop
            partial: quick,
            hold: quick ? 'late' : true,
            onDone: () => {
                this._morphs.delete(boxPointer);
                onComplete?.();
            },
        });
        this._morphs.set(boxPointer, morph);
    }

    close(boxPointer, onComplete, quick = false) {
        // left for the next menu: gone at once, so two liquid bodies never meet (seen in the
        // user's recording: two or three translucent menus stacked while skimming)
        if (quick) {
            this.takeOver(boxPointer).forEach(piece => piece.restore());
            boxPointer.set_scale(1, 1);
            // it stays up for the frames the next menu needs for its layout (no blank frame between
            // the two), then goes at once
            this.closeSoon(boxPointer, onComplete);
            return undefined;
        }
        const previous = this.takeOver(boxPointer);
        const source = boxPointer._sourceActor;
        boxPointer._muteInput.enabled = true;
        boxPointer._muteKeys.enabled = true;
        boxPointer.remove_all_transitions();
        const morph = new Morph(boxPointer, false, {
            origin: stageRect(source),
            originKey: originKey(source),
            pieces: this.piecesOf(boxPointer, previous),
            quickSettings: this.isQuickSettings(boxPointer),
            onDone: () => {
                this._morphs.delete(boxPointer);
                boxPointer.hide();
                boxPointer.opacity = 0;
                boxPointer.translation_x = 0;
                boxPointer.translation_y = 0;
                onComplete?.();
            },
        });
        this._morphs.set(boxPointer, morph);
    }
}
