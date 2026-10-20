// Liquid Glass under GNOME's password field on the lock screen, as on the login screen.
//
// The glass is ours, in our own layer on the dialog, just below the dialog's content (above the
// lock background): nothing of ours goes inside GNOME's prompt (docs/LOCKSCREEN_PLAN.md: add to
// our own layers, move GNOME's only by translation). The pane follows the entry's place on
// screen: the stack's translation (layout.js), GNOME's page crossfade (the prompt box's opacity,
// scale and translation), the password/text entry swap and each new prompt (GNOME builds one each
// time the screen wakes). In the crossfade it follows the scale with its own scale, so its glass
// mask is not rebuilt every frame. It shakes along with GNOME's wrong-password wiggle. While the glass shows (.tahoe-lock-glass-prompt on the dialog)
// lockscreen.css clears the entry's own fill.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {GlassPane, THIN_EDGE} from './widgets/paneglass.js';

const STYLE_CLASS = 'tahoe-lock-glass-prompt';

// backdrop: () => the primary monitor's lock background actor
export function buildPromptGlass(frame, dialog, backdrop) {
    // our layer: just above the lock background, so it is under all of GNOME's content (the
    // prompt, and the buttons at the bottom)
    const background = dialog._backgroundGroup;
    if (!background || background.get_parent() !== dialog)
        throw new Error('the unlock dialog has changed (no background group)');

    const layer = new Clutter.Actor({name: 'prompt-glass-layer', reactive: false});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);
    dialog.set_child_above_sibling(layer, background);
    frame.addStyleClass(dialog, STYLE_CLASS);

    // what gets glass: the password field, the back button beside it and Switch User (GNOME's
    // buttons are capsules on glass, as on the login screen; the user, 2026-10-20)
    const TARGETS = [
        () => dialog._authPrompt?._entry,
        () => dialog._authPrompt?.cancelButton,
        () => dialog._otherUserButton,
    ];
    const panes = TARGETS.map(() => {
        const pane = new GlassPane(backdrop, 'capsule', THIN_EDGE);
        pane.set_pivot_point(0, 0);
        layer.add_child(pane);
        pane.hide();
        pane.connect('mask-failed', () => frame.fail(`prompt glass: ${pane.failed}`));
        return pane;
    });

    // each pane over its actor, as GNOME has it on screen now
    const follow = (actor, pane) => {
        if (!actor || !actor.mapped || actor.get_paint_opacity() === 0) {
            pane.hide();
            return;
        }
        const box = actor.get_allocation_box();
        const w = box.get_width(), h = box.get_height();
        if (!(w > 0 && h > 0)) {
            pane.hide();
            return;
        }
        const [x, y] = actor.get_transformed_position();
        const [tw, th] = actor.get_transformed_size();
        const [dx, dy] = dialog.get_transformed_position();
        pane.set_size(w, h);
        pane.set_position(Math.round(x - dx), Math.round(y - dy));
        pane.set_scale(tw / w, th / h);
        pane.opacity = actor.get_paint_opacity();
        pane.show();
    };
    const sync = () => TARGETS.forEach((target, i) => follow(target(), panes[i]));

    // not from inside a layout pass (moving the pane then makes Clutter warn): once, just before
    // the next frame
    const laters = global.compositor.get_laters();
    let laterId = 0;
    const schedule = () => {
        laterId ||= laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            laterId = 0;
            frame.guard(sync);
            return GLib.SOURCE_REMOVE;
        });
    };
    frame.addUndo(() => {
        if (laterId)
            laters.remove(laterId);
        laterId = 0;
    });

    // what moves the entry: GNOME's crossfade on the prompt box, our translation of the stack,
    // GNOME's layout, the entry swap, a new prompt
    const box = dialog._promptBox;
    for (const prop of ['opacity', 'scale-x', 'scale-y', 'translation-y', 'allocation', 'visible'])
        frame.connect(box, `notify::${prop}`, schedule);
    for (const prop of ['translation-y', 'allocation'])
        frame.connect(dialog._stack, `notify::${prop}`, schedule);
    if (dialog._adjustment)   // GNOME's clock-to-prompt transition
        frame.connect(dialog._adjustment, 'notify::value', schedule);
    const watched = new WeakSet();   // the actors already followed (nothing is set on GNOME's)
    // the pane takes the entry's paint opacity, so it follows a fade on any actor between the
    // entry and the dialog (GNOME fades the prompt in through more than the prompt box: the pane
    // stayed at its first faint frame, 8 of 255, and the field looked like GNOME's flat pill)
    const watchFades = actor => {
        for (let a = actor; a && a !== dialog; a = a.get_parent()) {
            if (watched.has(a))
                continue;
            watched.add(a);
            frame.connect(a, 'notify::opacity', schedule);
        }
    };
    const watchPrompt = prompt => {
        if (!prompt || watched.has(prompt))
            return;
        watchFades(prompt._entry ?? prompt);
        watchFades(prompt.cancelButton);
        frame.connect(prompt, 'notify::allocation', schedule);
        const area = prompt._entryArea;
        if (area) {
            frame.connect(area, 'notify::allocation', schedule);
            frame.connect(area, 'notify::translation-x', schedule);   // GNOME's wrong-password wiggle
            frame.connect(area, 'child-added', () => {   // the password/text entry swap
                watchFades(prompt._entry);
                schedule();
            });
        }
    };
    watchPrompt(dialog._authPrompt);
    // the buttons outside the prompt (Switch User): their fades and moves
    for (const target of TARGETS.slice(1)) {
        const actor = target();
        if (!actor)
            continue;
        watchFades(actor);
        for (let a = actor; a && a !== dialog; a = a.get_parent()) {
            frame.connect(a, 'notify::allocation', schedule);
            frame.connect(a, 'notify::visible', schedule);
        }
    }
    frame.connect(box, 'child-added', () => {
        watchPrompt(dialog._authPrompt);
        schedule();
    });
    schedule();
}
