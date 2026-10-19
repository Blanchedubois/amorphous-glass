// Tahoe Motion: Liquid Glass open and close animations for the shell's glass popups.
//
// A popup opens as a glass circle the size of the clicked icon's capsule, at the edge of the
// popup nearest the icon, growing into the card on a slightly springy curve while its corners
// relax to the card's radius. The content rides with the glass: scaled with the shape and
// kept inside it, fully opaque after a short fade at the start (user, 2026-10-19). It closes back
// into the circle, faster and without overshoot. Quick settings pieces each grow from a small
// circle at their own centre, one after the other; submenus grow out of their toggle; banners
// from a capsule at their top; GTK app menus from the pointer (open only: GNOME destroys their
// windows before an extension hears of it).
//
// The glass is drawn by the patched Blur My Shell (config/bms-tahoe-glass.patch): this extension
// only drives its reveal shape and freezes its backdrop for the animation, through the
// `globalThis.__tahoeGlass` API. Without that API, with animations off or reduced motion, popups
// open as GNOME opens them. docs/gnome-tahoe/animations.md, Phase 4.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { State as TrayState } from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { lerp, smoothstep, springClose, springOpen } from './spring.js';

const OPEN_MS = 260;
const CLOSE_MS = 160;
const STAGGER_MS = 12;
const CIRCLE_PX = 34;
const CIRCLE_MIN_PX = 24;
const CIRCLE_MAX_PX = 48;
const PIECE_CIRCLE = 0.5;
// the content fades in over the first part of the growth, then only rides with the shape
const CONTENT_FADE = 0.25;
// the circle itself fades in (and out, on close) over the first part
const CIRCLE_FADE = 0.2;
// how long a banner's or app menu's animation waits for its glass to appear
const LAZY_MS = 150;
const APP_MENU_TYPES = [
    Meta.WindowType.DROPDOWN_MENU, Meta.WindowType.POPUP_MENU, Meta.WindowType.MENU, Meta.WindowType.COMBO,
];

function glassApi() {
    const api = globalThis.__tahoeGlass;
    return api?.version >= 1 ? api : null;
}

function animationsOn() {
    const settings = St.Settings.get();
    return settings.enable_animations && settings.reducedMotion !== St.ReducedMotion.REDUCE;
}

function slowDown() {
    return St.Settings.get().slow_down_factor || 1;
}

function lerpRect(a, b, t) {
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t),
    };
}

/// the stage rectangle of an actor
function stageRect(actor) {
    if (!actor?.get_stage())
        return null;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    if (![x, y, width, height].every(Number.isFinite))
        return null;
    return { x, y, width, height };
}

/// One glass surface of a popup and its content, animated between the circle and the card.
class Piece {
    /// `content`: the actors that fade and scale (default: the glass's target fades, its children
    /// scale; the target's glass ignores its fade)
    constructor(surface, q, content = null) {
        this.surface = surface;
        this.target = surface.target;
        this.q = q;
        this.ready = false;
        this.fading = content ?? [this.target];
        this.scaling = content;
        if (!content)
            this.target._tahoe_glass_opacity_free = true;
    }

    setFade(opacity) {
        for (const actor of this.fading)
            actor.opacity = opacity;
    }

    /// geometry, once the popup is laid out; `origin`: the stage rectangle the circle grows from
    /// (null: the piece's own centre)
    layout(origin, quickSettings, geometry = null) {
        if (this.ready || !this.target.has_allocation())
            return this.ready;
        if (geometry) {
            const shape = geometry(this);
            if (!shape)
                return false;
            Object.assign(this, shape);
            this.centre = [shape.card.x + shape.card.width / 2, shape.card.y + shape.card.height / 2];
            this.ready = true;
            return true;
        }
        const card = this.surface.glass_rect();
        if (card.width < 2 || card.height < 2)
            return false;
        let diameter;
        let cx;
        let cy;
        if (!origin || quickSettings) {
            diameter = Math.min(card.width, card.height) * PIECE_CIRCLE;
            cx = card.x + card.width / 2;
            cy = card.y + card.height / 2;
        } else {
            diameter = origin.width > 0 && origin.height > 0
                ? Math.min(Math.max(Math.min(origin.width, origin.height), CIRCLE_MIN_PX), CIRCLE_MAX_PX)
                : CIRCLE_PX;
            diameter = Math.min(diameter, card.width, card.height);
            const [ok, ox, oy] = this.target.transform_stage_point(
                origin.x + origin.width / 2, origin.y + origin.height / 2);
            // under the icon: the point of the card's edge nearest to it
            cx = ok ? ox : card.x + card.width / 2;
            cy = ok ? oy : card.y;
            cx = Math.min(Math.max(cx, card.x + diameter / 2), card.x + card.width - diameter / 2);
            cy = Math.min(Math.max(cy, card.y + diameter / 2), card.y + card.height - diameter / 2);
        }
        this.circle = { x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter };
        this.card = card;
        this.circleRadius = diameter / 2;
        this.cardRadius = Math.min(this.surface.corner_radius, card.width / 2, card.height / 2);
        this.centre = [card.x + card.width / 2, card.y + card.height / 2];
        this.ready = true;
        return true;
    }

    /// `q`: 0 the circle, 1 the card (a little over 1 while the spring overshoots)
    apply(q) {
        this.q = q;
        if (!this.ready) {
            this.surface.set_reveal({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
            this.setFade(0);
            return;
        }
        const shape = Math.min(1, Math.max(0, q));
        const rect = lerpRect(this.circle, this.card, shape);
        this.surface.set_reveal({
            ...rect,
            radius: lerp(this.circleRadius, this.cardRadius, shape),
        });
        // the content rides with the glass: scaled with the shape, at full opacity, cut at its
        // edge; only a short fade at the start, so the small circle never shows a squashed icon
        this.setFade(Math.round(255 * smoothstep(0, CONTENT_FADE, q)));
        this.morphContent(rect, shape);
    }

    /// maps the card onto the reveal rectangle with one uniform scale that fits inside it, centred
    /// on it: the whole target (its own fill and edge too) for shell popups, whose glass Blur My
    /// Shell keeps in place; the window's content actors for app menus (the glass is their sibling)
    morphContent(rect, shape) {
        const card = this.card;
        if (this.startScale === undefined) {
            this.startScale = Math.min(this.circle.width / card.width, this.circle.height / card.height);
            const actors = this.scaling ?? [this.target];
            this.saved = actors.map(actor => ({
                actor,
                pivot: actor.pivot_point,
                scale_x: actor.scale_x,
                scale_y: actor.scale_y,
                translation_x: actor.translation_x,
                translation_y: actor.translation_y,
            }));
            if (!this.scaling)
                this.target._tahoe_glass_transform_free = true;
        }
        const scale = lerp(this.startScale, 1, shape);
        const [cx, cy] = this.centre;
        const rx = rect.x + rect.width / 2;
        const ry = rect.y + rect.height / 2;
        for (const { actor } of this.saved) {
            // the card's centre, in the actor's own coordinates, lands on the reveal's centre
            const ox = this.scaling ? actor.x : 0;
            const oy = this.scaling ? actor.y : 0;
            actor.set_pivot_point(0, 0);
            actor.set_scale(scale, scale);
            actor.translation_x = rx - scale * (cx - ox) - ox;
            actor.translation_y = ry - scale * (cy - oy) - oy;
        }
    }

    restore() {
        this.surface.set_reveal(null);
        for (const { actor, pivot, scale_x, scale_y, translation_x, translation_y } of this.saved ?? []) {
            actor.set_pivot_point(pivot.x, pivot.y);
            actor.set_scale(scale_x, scale_y);
            actor.translation_x = translation_x;
            actor.translation_y = translation_y;
        }
        this.saved = null;
        this.startScale = undefined;
        this.setFade(255);
        delete this.target._tahoe_glass_opacity_free;
        delete this.target._tahoe_glass_transform_free;
    }
}

/// The animation of one popup, open or close, on its own frame clock.
class Morph {
    /// `only`: the target to animate (a submenu), `geometry`: its circle and card, `step`: called
    /// with the progress at each frame, `fadeRoot`: fade the popup in and out with the circle
    constructor(root, opening, { origin, quickSettings, previous, onDone, only = null, geometry = null, step = null, fadeRoot = true, busy = null, lazy = false, pieces = null }) {
        this.pieces = [];
        this.root = root;
        this.opening = opening;
        this.origin = origin;
        this.quickSettings = quickSettings;
        this.onDone = onDone;
        this.geometry = geometry;
        this.step = step;
        this.fadeRoot = fadeRoot;
        // glass that Blur My Shell creates in the first frames (a banner just added) joins in
        this.lazy = lazy;
        const api = glassApi();
        this.held = pieces ? false : api.hold(root);
        const start = opening ? 0 : 1;
        // an interrupted animation hands over its pieces as they are (shape, content, saved state)
        this.pieces = pieces ?? api.surfaces(root)
            .filter(surface => only ? surface.target === only
                : !busy?.has(surface.target) && (surface.target.mapped || previous?.has(surface.target)))
            .map(surface => {
                const piece = previous?.get(surface.target) ?? new Piece(surface, start);
                previous?.delete(surface.target);
                piece.startedAt = piece.from = piece.delay = undefined;
                return piece;
            });
        previous?.forEach(piece => piece.restore());
        this.duration = (opening ? OPEN_MS : CLOSE_MS) * slowDown();
        this.stagger = opening && quickSettings ? STAGGER_MS * slowDown() : 0;
        // laid out already (a close, or a popup shown before): no empty first frame
        this.pieces.forEach(piece => piece.layout(origin, quickSettings, geometry));
        this.order();
        this.pieces.forEach(piece => piece.apply(piece.q));
        const reach = Math.max(0, ...this.pieces.filter(piece => piece.ready).map(piece => piece.q));
        if (fadeRoot)
            root.opacity = Math.round(255 * smoothstep(0, CIRCLE_FADE, reach));
        this.step?.(reach);
        this.timeline = new Clutter.Timeline({
            actor: root,
            duration: Math.ceil(this.duration + this.stagger * this.pieces.length) + 1000,
        });
        this.timeline.connect('new-frame', () => this.frame());
        this.timeline.start();
    }

    frame() {
        const now = this.timeline.get_elapsed_time();
        if (typeof this.lazy === 'function' && now < LAZY_MS * slowDown()) {
            if (this.pieces.length === 0) {
                const piece = this.lazy();
                if (piece)
                    this.pieces.push(piece);
            }
        } else if (this.lazy && now < LAZY_MS * slowDown()) {
            const known = new Set(this.pieces.map(piece => piece.target));
            for (const surface of glassApi()?.surfaces(this.root) ?? []) {
                if (!known.has(surface.target) && surface.target.mapped)
                    this.pieces.push(new Piece(surface, this.opening ? 0 : 1));
            }
            if (!this.held)
                this.held = glassApi()?.hold(this.root) ?? false;
        }
        let done = this.pieces.length > 0 || !this.lazy || now >= LAZY_MS * slowDown();
        let reach = 0;
        this.pieces.forEach(piece => {
            if (!piece.ready && piece.layout(this.origin, this.quickSettings, this.geometry))
                this.order();
            if (!piece.ready) {
                piece.apply(piece.q);
                done = false;
                return;
            }
            piece.startedAt ??= now;
            piece.from ??= piece.q;
            const t = now - piece.startedAt - (piece.delay ?? 0);
            const p = this.opening ? springOpen(t, this.duration) : springClose(t, this.duration);
            piece.apply(lerp(piece.from, this.opening ? 1 : 0, p));
            reach = Math.max(reach, piece.q);
            if (t < this.duration)
                done = false;
        });
        // no hard pop of the first or last circle
        if (this.fadeRoot)
            this.root.opacity = Math.round(255 * smoothstep(0, CIRCLE_FADE, reach));
        this.step?.(reach);
        if (done)
            this.finish();
    }

    /// quick settings pieces arrive one after the other, nearest the clicked icon first
    order() {
        if (!this.stagger)
            return;
        const origin = this.origin;
        const distance = piece => {
            const rect = stageRect(piece.target);
            if (!rect || !origin)
                return 0;
            return Math.hypot(rect.x + rect.width / 2 - (origin.x + origin.width / 2),
                rect.y + rect.height / 2 - (origin.y + origin.height / 2));
        };
        this.pieces.filter(piece => piece.ready && piece.startedAt === undefined)
            .sort((a, b) => distance(a) - distance(b))
            .forEach((piece, index) => (piece.delay = index * this.stagger));
    }

    /// stops where it is: the pieces keep their shape for the next animation to start from
    interrupt() {
        this.stopTimeline();
        this.release();
        return new Map(this.pieces.map(piece => [piece.target, piece]));
    }

    finish() {
        this.stopTimeline();
        if (this.opening) {
            this.pieces.forEach(piece => piece.restore());
            if (this.fadeRoot)
                this.root.opacity = 255;
        }
        this.onDone?.();
        if (!this.opening)
            this.pieces.forEach(piece => piece.restore());
        this.release();
    }

    stopTimeline() {
        if (!this.timeline)
            return;
        this.timeline.stop();
        this.timeline.run_dispose();
        this.timeline = null;
    }

    release() {
        if (!this.held)
            return;
        this.held = false;
        glassApi()?.release(this.root);
    }

    destroy() {
        this.stopTimeline();
        this.pieces.forEach(piece => piece.restore());
        this.release();
    }
}

export default class TahoeMotion extends Extension {
    enable() {
        this._morphs = new Map();
        const proto = BoxPointer.BoxPointer.prototype;
        this._boxOpen = proto.open;
        this._boxClose = proto.close;
        const motion = this;
        proto.open = function (animate, onComplete) {
            if (!motion.handles(this, animate))
                return motion._boxOpen.call(this, animate, onComplete);
            return motion.open(this, onComplete);
        };
        proto.close = function (animate, onComplete) {
            if (!this.visible)
                return undefined;
            if (!motion.handles(this, animate))
                return motion._boxClose.call(this, animate, onComplete);
            return motion.close(this, onComplete);
        };
        this.patchBanners();
        this.watchAppMenus();
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

    /// A quick settings submenu grows out of its toggle: the card widens from the toggle's capsule
    /// while its height opens on the same spring, pushing the pieces below; the rows fade in.
    /// GNOME's own height and row animations (started just before) are replaced.
    submenu(menu, opening) {
        const quickSettings = Main.panel.statusArea.quickSettings?.menu;
        const root = quickSettings?._boxPointer;
        const api = glassApi();
        if (!root || !api || !animationsOn())
            return;
        const target = menu.box;
        if (!api.surfaces(root).some(surface => surface.target === target))
            return;
        const container = menu.actor;
        const previous = this.takeOver(target);
        container.remove_transition('height');
        target.remove_transition('opacity');
        const startHeight = container.height;
        container.height = -1;
        const [, fullHeight] = container.get_preferred_height(-1);
        container.height = startHeight;
        const morph = new Morph(root, opening, {
            origin: stageRect(menu.sourceActor),
            quickSettings: false,
            previous,
            only: target,
            fadeRoot: false,
            geometry: () => {
                const card = { x: 0, y: 0, width: target.width, height: Math.max(fullHeight, 2) };
                const toggle = stageRect(menu.sourceActor);
                const [ok, tx] = toggle ? target.transform_stage_point(toggle.x, toggle.y) : [false, 0];
                const width = Math.min(toggle?.width ?? card.width, card.width);
                const height = Math.min(toggle?.height ?? 48, card.height);
                const x = ok ? Math.min(Math.max(tx, 0), card.width - width) : 0;
                return {
                    circle: { x, y: 0, width, height },
                    card,
                    circleRadius: height / 2,
                    cardRadius: Math.min(api.surfaces(root).find(s => s.target === target)?.corner_radius ?? 32,
                        card.width / 2, card.height / 2),
                };
            },
            step: q => {
                container.height = Math.max(0, lerp(0, fullHeight, q));
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
                previous?.forEach(piece => piece.restore());
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
            x: rect.x + rect.width / 2 - CIRCLE_PX / 2, y: rect.y, width: CIRCLE_PX, height: CIRCLE_PX,
        };
        const morph = new Morph(bin, opening, {
            origin,
            quickSettings: false,
            previous,
            lazy: opening,
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
        const [px, py] = global.get_pointer();
        const origin = { x: px - CIRCLE_PX / 2, y: py - CIRCLE_PX / 2, width: CIRCLE_PX, height: CIRCLE_PX };
        const content = () => windowActor.get_children()
            .filter(child => child !== window.blur_actor);
        // hidden until its glass exists (Blur My Shell makes it right after the map)
        content().forEach(child => (child.opacity = 0));
        const makePiece = () => {
            const glass = glassApi()?.app_menu(window);
            if (!glass)
                return null;
            return new Piece({ ...glass, target: windowActor }, 0, content());
        };
        const morph = new Morph(windowActor, true, {
            origin,
            quickSettings: false,
            pieces: [],
            fadeRoot: false,
            lazy: makePiece,
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

    handles(boxPointer, animate) {
        const api = glassApi();
        return Boolean(animate) && animationsOn() && api !== null
            && api.surfaces(boxPointer).length > 0;
    }

    isQuickSettings(boxPointer) {
        return boxPointer === Main.panel.statusArea.quickSettings?.menu?._boxPointer;
    }

    takeOver(boxPointer) {
        const running = this._morphs.get(boxPointer);
        this._morphs.delete(boxPointer);
        return running ? running.interrupt() : null;
    }

    open(boxPointer, onComplete) {
        this.patchSubmenus();
        const previous = this.takeOver(boxPointer);
        boxPointer.remove_all_transitions();
        boxPointer.set({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        boxPointer._muteKeys.enabled = false;
        boxPointer.show();
        const morph = new Morph(boxPointer, true, {
            origin: stageRect(boxPointer._sourceActor),
            quickSettings: this.isQuickSettings(boxPointer),
            previous,
            busy: this._morphs,
            onDone: () => {
                this._morphs.delete(boxPointer);
                boxPointer._muteInput.enabled = false;
                onComplete?.();
            },
        });
        this._morphs.set(boxPointer, morph);
    }

    close(boxPointer, onComplete) {
        const previous = this.takeOver(boxPointer);
        boxPointer._muteInput.enabled = true;
        boxPointer._muteKeys.enabled = true;
        boxPointer.remove_all_transitions();
        const morph = new Morph(boxPointer, false, {
            origin: stageRect(boxPointer._sourceActor),
            quickSettings: this.isQuickSettings(boxPointer),
            previous,
            busy: this._morphs,
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
