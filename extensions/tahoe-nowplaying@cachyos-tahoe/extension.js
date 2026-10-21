// Tahoe Now Playing: a full-screen Now Playing view over the desktop, opened with a hotkey
// (default Super+Shift+M, the settings key `toggle`). See docs/NOWPLAYING_PLAN.md.
// overlay.js holds the view and its safety rules; keys.js the key map.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Overlay} from './overlay.js';

export default class TahoeNowPlaying extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = null;
        // the player's keys and buttons; the test driver listens here (Phase 3 wires MPRIS)
        this.onAction = null;
        Main.wm.addKeybinding('toggle', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle());
    }

    get overlay() {
        return this._overlay;
    }

    // open, or close; pressed during the exit it opens again (the old one goes at once)
    toggle() {
        const old = this._overlay;
        if (old && old.state !== 'closing' && old.state !== 'closed') {
            old.close();
            return;
        }
        old?.teardown();
        const overlay = new Overlay({
            settings: this._settings,
            onClosed: () => {
                if (this._overlay === overlay)
                    this._overlay = null;
            },
            onAction: action => this.onAction?.(action),
        });
        this._overlay = overlay;
        let opened = false;
        try {
            opened = overlay.open();
        } catch (e) {
            console.error(`tahoe-nowplaying: open failed: ${e}\n${e?.stack ?? ''}`);
        }
        if (!opened) {
            overlay.teardown();
            if (this._overlay === overlay)
                this._overlay = null;
        }
    }

    disable() {
        Main.wm.removeKeybinding('toggle');
        this._overlay?.teardown();
        this._overlay = null;
        this._settings = null;
        this.onAction = null;
    }
}
