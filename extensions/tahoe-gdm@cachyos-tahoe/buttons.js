// GNOME's buttons on the login screen as capsules on Liquid Glass (the user, 2026-10-20), as on the
// lock screen (tahoe-lockscreen promptglass.js): "Not listed?", the back button beside the
// password field, the session menu, the accessibility menu and the top-right status pill. Each gets a glass pane in our own
// layer under the login dialog (just above the backdrop), following the button's place, size,
// scale and fade on screen; nothing of ours goes inside GNOME's buttons. While the glass is on,
// stylesheet.css clears their own fill and rounds them.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane, THIN_EDGE} from './glass.js';

const CLASSES = [
    'login-dialog-not-listed-button',
    'cancel-button',
    'login-dialog-session-list-button',
    'a11y-button',
    'login-dialog-auth-menu-button',   // Login Options: the gear (the session: GNOME, GNOME on Xorg...)
];

export function buildButtons(ext, dialog, backdrop) {
    const group = Main.screenShield._lockDialogGroup;
    const buttons = [];
    const find = actor => {
        if (actor instanceof St.Button && CLASSES.some(c => actor.has_style_class_name(c)))
            buttons.push(actor);
        actor.get_children().forEach(find);
    };
    find(dialog);
    // the top-right status pill (the system menu's button) as a glass capsule too
    const pill = Main.panel?.statusArea?.quickSettings;
    if (pill) {
        buttons.push(pill);
        pill.add_style_class_name('tahoe-glass-pill');
        ext._undo.push(() => pill.remove_style_class_name('tahoe-glass-pill'));
    }
    if (!buttons.length)
        return;

    // "Not listed?" centred under the rows, its label centred in it (GNOME starts both at the left:
    // measured 14 px left of the rows, 14 px before its text and 26 px after)
    const notListed = dialog._notListedButton;
    if (notListed) {
        const label = notListed.get_child();
        const old = [notListed.x_align, label?.x_align];
        notListed.x_align = Clutter.ActorAlign.CENTER;
        if (label)
            label.x_align = Clutter.ActorAlign.CENTER;
        ext._undo.push(() => {
            notListed.x_align = old[0];
            if (label)
                label.x_align = old[1];
        });
    }

    const layer = new Clutter.Actor({name: 'tahoe-gdm-buttons', reactive: false});
    layer.add_constraint(new Clutter.BindConstraint({source: group, coordinate: Clutter.BindCoordinate.SIZE}));
    group.insert_child_above(layer, backdrop());
    ext._undo.push(() => layer.destroy());

    const panes = buttons.map(() => {
        const pane = new GlassPane(backdrop, 'capsule', THIN_EDGE);
        pane.set_pivot_point(0, 0);
        pane.hide();
        pane.connect('mask-failed', () => ext._fail(`button glass: ${pane.failed}`));
        layer.add_child(pane);
        return pane;
    });

    const follow = (button, pane) => {
        const opacity = button.mapped ? button.get_paint_opacity() : 0;
        const box = button.get_allocation_box();
        // the drawn shape: inside the button's (transparent) border, as GNOME draws its fill
        const node = button.get_theme_node();
        const [bl, br, bt, bb] = [St.Side.LEFT, St.Side.RIGHT, St.Side.TOP, St.Side.BOTTOM].map(side => node.get_border_width(side));
        const w = box.get_width() - bl - br, h = box.get_height() - bt - bb;
        if (!opacity || !(w > 0 && h > 0)) {
            pane.hide();
            return;
        }
        const [x, y] = button.get_transformed_position();
        const [tw, th] = button.get_transformed_size();
        const k = tw / box.get_width();
        const [gx, gy] = group.get_transformed_position();
        pane.set_size(w, h);
        pane.set_position(Math.round(x + bl * k - gx), Math.round(y + bt * th / box.get_height() - gy));
        pane.set_scale(k, th / box.get_height());
        pane.opacity = opacity;
        pane.show();
    };

    // not from inside a layout pass: once, just before the next frame
    const laters = global.compositor.get_laters();
    let laterId = 0;
    const schedule = () => {
        laterId ||= laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            laterId = 0;
            try {
                buttons.forEach((button, i) => follow(button, panes[i]));
            } catch (e) {
                ext._fail(`buttons: ${e}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    };
    ext._undo.push(() => {
        if (laterId)
            laters.remove(laterId);
        laterId = 0;
    });

    // what moves or fades a button: it or anything above it (the prompt's crossfade and wiggle,
    // the layout module's padding, the user list showing and hiding)
    const watched = new Set();
    for (const button of buttons) {
        for (let a = button; a && a !== group; a = a.get_parent()) {
            if (watched.has(a))
                continue;
            watched.add(a);
            const ids = ['allocation', 'opacity', 'visible', 'mapped', 'translation-x', 'translation-y', 'scale-x', 'scale-y']
                .map(prop => a.connect(`notify::${prop}`, schedule));
            ext._undo.push(() => ids.forEach(id => {
                try {
                    a.disconnect(id);
                } catch {}   // GNOME already destroyed it (a rebuilt prompt)
            }));
        }
    }
    schedule();
}
