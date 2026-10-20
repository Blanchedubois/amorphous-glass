// Liquid Glass under GNOME's password field on the lock screen, as on the login screen.
//
// The glass is ours, in our own layer on the dialog, just below the dialog's content (above the
// lock background): nothing of ours goes inside GNOME's prompt (docs/LOCKSCREEN_PLAN.md: add to
// our own layers, move GNOME's only by translation). The pane follows the entry's place on
// screen: the stack's translation (layout.js), GNOME's page crossfade (the prompt box's opacity,
// scale and translation), the password/text entry swap and each new prompt (GNOME builds one each
// time the screen wakes). In the crossfade it follows the scale with its own scale, so its glass
// mask is not rebuilt every frame. While the glass shows (.tahoe-lock-glass-prompt on the dialog)
// lockscreen.css clears the entry's own fill.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {GlassPane} from './widgets/paneglass.js';

const STYLE_CLASS = 'tahoe-lock-glass-prompt';

// backdrop: () => the primary monitor's lock background actor
export function buildPromptGlass(frame, dialog, backdrop) {
    // the dialog's direct child that holds GNOME's stack: our layer goes just below it
    let content = dialog._stack;
    while (content && content.get_parent() !== dialog)
        content = content.get_parent();
    if (!content)
        throw new Error('the unlock dialog has changed (no content box)');

    const layer = new Clutter.Actor({name: 'prompt-glass-layer', reactive: false});
    layer.add_constraint(new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE}));
    frame.addActor(dialog, layer);
    dialog.set_child_below_sibling(layer, content);

    const pane = new GlassPane(backdrop, 'capsule');
    pane.set_pivot_point(0, 0);
    layer.add_child(pane);
    pane.hide();
    pane.connect('mask-failed', () => frame.fail(`prompt glass: ${pane.failed}`));
    frame.addStyleClass(dialog, STYLE_CLASS);

    // the pane over the entry, as GNOME has it on screen now
    const sync = () => {
        const entry = dialog._authPrompt?._entry;
        if (!entry || !entry.mapped || entry.get_paint_opacity() === 0) {
            pane.hide();
            return;
        }
        const box = entry.get_allocation_box();
        const w = box.get_width(), h = box.get_height();
        if (!(w > 0 && h > 0)) {
            pane.hide();
            return;
        }
        const [x, y] = entry.get_transformed_position();
        const [tw, th] = entry.get_transformed_size();
        const [dx, dy] = dialog.get_transformed_position();
        pane.set_size(w, h);
        pane.set_position(Math.round(x - dx), Math.round(y - dy));
        pane.set_scale(tw / w, th / h);
        pane.opacity = entry.get_paint_opacity();
        pane.show();
    };

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
    const watched = new WeakSet();   // the prompts already followed (nothing is set on GNOME's)
    const watchPrompt = prompt => {
        if (!prompt || watched.has(prompt))
            return;
        watched.add(prompt);
        frame.connect(prompt, 'notify::allocation', schedule);
        const area = prompt._entryArea;
        if (area) {
            frame.connect(area, 'notify::allocation', schedule);
            frame.connect(area, 'child-added', schedule);   // the password/text entry swap
        }
    };
    watchPrompt(dialog._authPrompt);
    frame.connect(box, 'child-added', () => {
        watchPrompt(dialog._authPrompt);
        schedule();
    });
    schedule();
}
