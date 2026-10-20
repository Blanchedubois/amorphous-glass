// Test only: an unlock-dialog extension that adds an actor to the dialog, then throws in enable().
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class Faulty extends Extension {
    enable() {
        this._w = new St.Widget({ reactive: true, x: 1000, y: 780, width: 560, height: 160, style: 'background-color: rgba(255,0,0,0.5);' });
        Main.screenShield._dialog?.add_child(this._w);
        throw new Error('injected: enable');
    }
    disable() { this._w?.destroy(); }
}
