// Tahoe Now Playing: a full-screen Now Playing view over the desktop, opened with a hotkey
// (default Super+Shift+M, the settings key `toggle`). See docs/NOWPLAYING_PLAN.md.
// overlay.js holds the view and its safety rules; keys.js the key map.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Overlay} from './overlay.js';

// an MPRIS player on the session bus (one quick local call, only for the hotkey)
function anyPlayer() {
    try {
        const [names] = Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, null, Gio.DBusCallFlags.NONE, 500, null).deep_unpack();
        return names.some(n => n.startsWith('org.mpris.MediaPlayer2.'));
    } catch {
        return true;   // unsure: open (the placeholder shows if nothing plays)
    }
}

export default class TahoeNowPlaying extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = null;
        // told of the player's keys and buttons (the test driver listens here)
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
        if (this._settings.get_string('when-nothing-plays') === 'stay-closed' && !anyPlayer())
            return;
        const overlay = new Overlay({
            settings: this._settings,
            onClosed: () => {
                if (this._overlay === overlay)
                    this._overlay = null;
            },
            onAction: (action, value) => this.onAction?.(action, value),
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
