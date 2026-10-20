// GNOME's buttons on the login screen as capsules on Liquid Glass (the user, 2026-10-20), as on the
// lock screen (tahoe-lockscreen promptglass.js): "Not listed?", the back button beside the
// password field, the session menu and the accessibility menu. Each gets a glass pane in our own
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
    if (!buttons.length)
        return;

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
        const w = box.get_width(), h = box.get_height();
        if (!opacity || !(w > 0 && h > 0)) {
            pane.hide();
            return;
        }
        const [x, y] = button.get_transformed_position();
        const [tw, th] = button.get_transformed_size();
        const [gx, gy] = group.get_transformed_position();
        pane.set_size(w, h);
        pane.set_position(Math.round(x - gx), Math.round(y - gy));
        pane.set_scale(tw / w, th / h);
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
