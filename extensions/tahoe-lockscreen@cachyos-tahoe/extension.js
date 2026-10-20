// Tahoe Lock Screen. Runs only in the "unlock-dialog" session mode, so GNOME Shell enables it when
// the screen locks and disables it (unloading stylesheet.css) on unlock. Phase 1 is styling only:
// GNOME's own UnlockDialog and AuthPrompt do all of the authentication, and if this extension
// fails to load, the shell keeps its stock lock screen. See docs/LOCKSCREEN_PLAN.md.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TahoeLockScreen extends Extension {
    enable() {}
    disable() {}
}
