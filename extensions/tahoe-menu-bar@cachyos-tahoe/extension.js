// Tahoe menu bar details. GPL-3.0-or-later, part of cachyos-tahoe-theme.
// The Apple menu is Kiwi Menu (installed by scripts/tahoe-menu-bar.sh) and the clock format is
// GNOME's own with the weekday on; this adds what no setting gives: the single Control Center
// glyph (SF Symbols' switch.2) where GNOME shows network, volume and power icons, and the Focus
// moon (SF moon.fill) left of it while Do Not Disturb is on, as macOS shows them.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TahoeMenuBar extends Extension {
    enable() {
        const icon = name => new Gio.FileIcon({file: this.dir.get_child('icons').get_child(`${name}-symbolic.svg`)});

        // Control Center glyph
        const qs = Main.panel.statusArea.quickSettings;
        this._qs = qs;
        // a panel button lays out its first child only, so the indicators box is taken out
        // (kept, the indicators keep adding themselves to it) and the glyph put in its place
        this._indicators = qs._indicators;
        qs.remove_child(this._indicators);
        this._glyph = new St.Icon({gicon: icon('tahoe-controlcenter'), style_class: 'system-status-icon tahoe-controlcenter-icon',
            y_align: Clutter.ActorAlign.CENTER});
        qs.add_child(this._glyph);

        // Focus moon, left of the Control Center
        this._focus = new PanelMenu.Button(0.0, 'Focus', true);
        this._focus.reactive = false;
        this._focus.add_child(new St.Icon({gicon: icon('tahoe-focus'), style_class: 'system-status-icon tahoe-focus-icon',
            y_align: Clutter.ActorAlign.CENTER}));
        const box = Main.panel._rightBox;
        const index = box.get_children().indexOf(qs.container);
        Main.panel.addToStatusArea('tahoe-focus', this._focus, index < 0 ? 0 : index, 'right');
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._notifications.connectObject('changed::show-banners', () => this._syncFocus(), this);
        this._syncFocus();
    }

    _syncFocus() {
        this._focus.visible = !this._notifications.get_boolean('show-banners');
    }

    disable() {
        this._notifications?.disconnectObject(this);
        this._notifications = null;
        this._focus?.destroy();
        this._focus = null;
        this._glyph?.destroy();
        this._glyph = null;
        if (this._indicators && this._qs)
            this._qs.add_child(this._indicators);
        this._indicators = null;
        this._qs = null;
    }
}
