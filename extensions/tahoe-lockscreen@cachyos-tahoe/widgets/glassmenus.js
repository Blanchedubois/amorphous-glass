// GNOME's menus on the login screen on frosted Liquid Glass (the user, 2026-10-20: the calendar
// under the clock "liquid glass with live blur", and every other glass area): the calendar, the
// system menu, the accessibility and keyboard menus, the session menu. Each menu is a BoxPointer;
// a glass pane goes just below it in its parent and follows its content's place, size and its
// open and close animation. The glass blurs the whole login screen behind it (its group), so it
// is live: the album swirl, the clock and the music card move under it. While the glass is on, stylesheet.css clears the menus' own
// fill. Nothing of ours goes inside GNOME's menus.
//
// Shared with the lock screen (an exact copy, tools/lockscreen/shared.list), so it takes its glass
// from the caller: owner {_undo: [] or {push}, _fail(reason)}, glass {GlassPane, MENU_GLASS} from
// that extension's glass module.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const RADIUS = 24;   // tokens/radius.json widget; the menu's own corner when the theme has one

export function buildMenus(ext, backdrop, {GlassPane, MENU_GLASS}) {
    const followed = new Map();   // BoxPointer -> its pane
    const laters = global.compositor.get_laters();
    const pending = new Set();

    const follow = (pointer, pane) => {
        const content = pointer.bin?.get_child?.() ?? pointer.bin;
        const opacity = pointer.mapped && content?.mapped ? pointer.get_paint_opacity() : 0;
        const box = content?.get_allocation_box();
        const w = box?.get_width() ?? 0, h = box?.get_height() ?? 0;
        if (!opacity || !(w > 0 && h > 0)) {
            pane.hide();
            return;
        }
        const [x, y] = content.get_transformed_position();
        const [tw, th] = content.get_transformed_size();
        const parent = pane.get_parent();
        const [px, py] = parent.get_transformed_position();
        // the menu's own corner (20 for a menu, 30 for the calendar, 36 for the system menu)
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const radius = Math.round(content.get_theme_node().get_border_radius(St.Corner.TOPLEFT) / scale) || RADIUS;
        if (pane._radius !== radius) {
            pane._radius = radius;
            pane.reshape();
        }
        pane.set_size(w, h);
        pane.set_position(Math.round(x - px), Math.round(y - py));
        pane.set_scale(tw / w, th / h);
        pane.opacity = opacity;
        pane.show();
    };
    // not from inside a layout pass: once, just before the next frame
    const schedule = (pointer, pane) => {
        if (pane._tahoeLater || !pane.get_parent())
            return;
        pane._tahoeLater = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            pending.delete(pane._tahoeLater);
            pane._tahoeLater = 0;
            try {
                follow(pointer, pane);
            } catch (e) {
                ext._fail(`menu glass: ${e}`);
            }
            return GLib.SOURCE_REMOVE;
        });
        pending.add(pane._tahoeLater);
    };
    ext._undo.push(() => {
        pending.forEach(id => laters.remove(id));
        pending.clear();
    });

    const adopt = pointer => {
        const parent = pointer.get_parent();
        if (followed.has(pointer) || !parent || !pointer.bin)
            return;
        // everything behind the menu blurred, not only the picture: the menus live above the
        // login screen's group (in the UI group), so their glass copies that whole group (the
        // clock, the card, the prompt) with no copy of itself; the picture if that ever fails
        const behind = () => Main.screenShield?._lockDialogGroup ?? backdrop();
        const pane = new GlassPane(behind, RADIUS, MENU_GLASS);
        pane.set_pivot_point(0, 0);
        pane.hide();
        pane.connect('mask-failed', () => ext._fail(`menu glass: ${pane.failed}`));
        parent.insert_child_below(pane, pointer);
        followed.set(pointer, pane);
        let paneGone = false;   // its parent may destroy it first (the shell shutting down)
        pane.connect('destroy', () => (paneGone = true));
        const update = () => schedule(pointer, pane);
        const ids = ['mapped', 'opacity', 'allocation', 'translation-x', 'translation-y', 'scale-x', 'scale-y', 'visible']
            .map(prop => [pointer, pointer.connect(`notify::${prop}`, update)]);
        ids.push([pointer.bin, pointer.bin.connect('notify::allocation', update)]);
        // GNOME may destroy a menu (the session menu is rebuilt): its pane goes with it
        ids.push([pointer, pointer.connect('destroy', () => {
            followed.delete(pointer);
            if (!paneGone)
                pane.destroy();
        })]);
        ext._undo.push(() => {
            ids.forEach(([obj, id]) => {
                try {
                    obj.disconnect(id);
                } catch {}
            });
            if (followed.get(pointer) === pane) {
                followed.delete(pointer);
                if (!paneGone)
                    pane.destroy();
            }
        });
        update();
    };

    // the menus there now, and any made later (they live in the UI group)
    const scan = actor => {
        if (actor.constructor?.name === 'BoxPointer' || actor.has_style_class_name?.('popup-menu-boxpointer'))
            adopt(actor);
        else
            actor.get_children().forEach(scan);
    };
    scan(Main.layoutManager.uiGroup);
    const uiGroup = Main.layoutManager.uiGroup;
    const addedId = uiGroup.connect('child-added', (_g, actor) => {
        try {
            scan(actor);
        } catch (e) {
            ext._fail(`menu glass: ${e}`);
        }
    });
    ext._undo.push(() => uiGroup.disconnect(addedId));

    // the menus' own fill goes while the glass is on (stylesheet.css)
    uiGroup.add_style_class_name('tahoe-gdm-glass-menus');
    ext._undo.push(() => uiGroup.remove_style_class_name('tahoe-gdm-glass-menus'));
}
