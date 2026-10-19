// Tahoe Control Center: opens in place of GNOME's quick settings. GPL-3.0-or-later, part of
// cachyos-tahoe-theme. The layout follows macOS Tahoe's Control Center as reproduced by
// micronixxx's GNOME-Tahoe (Kiwi fork, GPL-3.0-or-later); the code here is our own.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ControlCenter} from './panel.js';

export default class TahoeControlCenter extends Extension {
    enable() {
        this._panel = null;
        const menu = Main.panel.statusArea.quickSettings?.menu;
        if (!menu)
            return;
        this._menu = menu;
        this._open = menu.open;
        this._close = menu.close;
        const openOriginal = () => this._open.call(menu);
        menu.open = () => {
            if (this._panel) {
                this._panel.close();
                return;
            }
            this._panel = new ControlCenter(openOriginal);
            this._panel.onClosed = () => (this._panel = null);
        };
        menu.close = () => this._panel?.close();
    }

    disable() {
        this._panel?.close();
        this._panel = null;
        if (this._menu) {
            this._menu.open = this._open;
            this._menu.close = this._close;
        }
        this._menu = null;
    }
}
