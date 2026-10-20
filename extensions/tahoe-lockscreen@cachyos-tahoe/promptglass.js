// Liquid Glass under GNOME's password field on the lock screen, as on the login screen
// (tahoe-gdm): a glass capsule as the first child of the AuthPrompt's entry area (a BinLayout
// that holds the entry; GNOME's password/text entry swap uses replace_child, which keeps ours).
// GNOME builds a new prompt each time the screen wakes, so each new one gets its glass. While the
// glass is there (.tahoe-lock-glass-prompt on the dialog) lockscreen.css clears the entry's fill.

import Clutter from 'gi://Clutter';

import {GlassPane} from './widgets/paneglass.js';

const STYLE_CLASS = 'tahoe-lock-glass-prompt';

// backdrop: the primary monitor's lock background actor
export function buildPromptGlass(frame, dialog, backdrop) {
    const glassFor = prompt => {
        const area = prompt?._entryArea;
        if (!area || !(area.layout_manager instanceof Clutter.BinLayout) || area._tahoeLockGlass)
            return;
        const pane = new GlassPane(backdrop, 'capsule');
        area.insert_child_at_index(pane, 0);
        area._tahoeLockGlass = pane;
        pane.connect('mask-failed', () => frame.fail(`prompt glass: ${pane.failed}`));
        frame.addUndo(() => {
            if (area._tahoeLockGlass === pane)
                delete area._tahoeLockGlass;
            if (pane.get_parent())
                pane.destroy();
        });
    };
    frame.addStyleClass(dialog, STYLE_CLASS);
    glassFor(dialog._authPrompt);
    frame.connect(dialog._promptBox, 'child-added', () => glassFor(dialog._authPrompt));
}
