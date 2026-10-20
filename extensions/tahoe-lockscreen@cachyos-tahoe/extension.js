// Tahoe Lock Screen. Runs only in the "unlock-dialog" session mode, so GNOME Shell enables it when
// the screen locks and disables it on unlock. GNOME's own UnlockDialog and AuthPrompt do all of
// the authentication; this extension only restyles and adds to the dialog, through the safety
// frame in frame.js, which puts GNOME's own lock screen back if anything goes wrong.
// See docs/LOCKSCREEN_PLAN.md.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Frame, versionSupported } from './frame.js';
import { buildLayout } from './layout.js';
import { buildMotion } from './motion.js';

export default class TahoeLockScreen extends Extension {
    enable() {
        this._frame = null;
        if (!versionSupported()) {
            console.warn('tahoe-lockscreen: untested GNOME Shell version, staying off');
            return;
        }
        // transactional: whatever start() did before an error is undone, so a failed enable
        // leaves GNOME's lock screen exactly as it was
        // the desktop widgets' stylesheet first (the Music widget), then ours over it
        const frame = new Frame([this.dir.get_child('widgets').get_child('widgets.css'), this.dir.get_child('lockscreen.css')]);
        frame.onDialog(buildLayout);
        frame.onDialog(buildMotion);
        try {
            frame.start();
            if (this._failAfterStartForTest)
                throw new Error('test: enable failed after start');
            this._frame = frame;
        } catch (e) {
            frame.fail(`enable failed: ${e}`);
        }
    }

    disable() {
        this._frame?.stop();
        this._frame = null;
    }
}
