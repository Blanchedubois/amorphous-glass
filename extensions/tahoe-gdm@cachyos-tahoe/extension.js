// Tahoe Login Screen (prototype, docs/GDM_PLAN.md phase 2). Runs only in session mode "gdm", the
// login screen. GDM's own LoginDialog and AuthPrompt do all of the authentication; this only adds
// Liquid Glass under GNOME's password field and behind each account row, a stylesheet that
// clears their flat fills while the glass is there, and the Tahoe proportions for the monitor
// (layout.js: the clock, and where the prompt and the rows sit). Every change is recorded and undone on
// disable, and on any error (enable throws, a glass mask fails), leaving GNOME's login screen.
//
// Never touched: the user verifier, the entries themselves, key focus, the dialog's layout.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { GlassPane } from './glass.js';
import { buildLayout } from './layout.js';
import { buildClock } from './clock.js';
import { buildWidgets } from './widgets.js';

// GNOME versions this was tested on; the private parts of LoginDialog it relies on
const TESTED_MAJORS = [51];
const STYLE_CLASS = 'tahoe-gdm-glass';

function log(message) {
    console.warn(`tahoe-gdm: ${message}`);
}

export default class TahoeLoginScreen extends Extension {
    enable() {
        this._undo = [];
        if (!TESTED_MAJORS.includes(Number.parseInt(Config.PACKAGE_VERSION, 10))) {
            log(`untested GNOME Shell ${Config.PACKAGE_VERSION}, staying off`);
            return;
        }
        try {
            this._build();
        } catch (e) {
            this._fail(`enable failed: ${e}`);
        }
    }

    disable() {
        this._restore();
    }

    _fail(reason) {
        log(`${reason}; putting GNOME's login screen back`);
        this._restore();
    }

    _restore() {
        const undo = this._undo ?? [];
        this._undo = [];
        while (undo.length) {
            try {
                undo.pop()();
            } catch (e) {
                log(`undo: ${e}`);
            }
        }
    }

    _build() {
        const dialog = Main.screenShield?._dialog;
        const prompt = dialog?._authPrompt;
        const entryArea = prompt?._entryArea;
        const userList = dialog?._userList;
        if (!entryArea || !(entryArea.layout_manager instanceof Clutter.BinLayout) ||
            !(userList?._items instanceof Map))
            throw new Error('LoginDialog is not as expected');

        // the picture the theme puts behind the login screen; without one there is nothing to
        // bend, and the theme's flat fills stay
        const background = Main.screenShield._lockDialogGroup?.get_theme_node()?.get_background_image();
        if (!background)
            throw new Error('no background picture in the theme');

        dialog.add_style_class_name(STYLE_CLASS);
        this._undo.push(() => dialog.remove_style_class_name(STYLE_CLASS));

        // GDM's banner (an administrator's login message) is empty here, but GNOME still lays it
        // out between the panel and the prompt; with the prompt low that space is negative
        // (Clutter warned "allocate a size of 8 x -172" on every frame of the login animation).
        // While it has no text it stays hidden, so LoginDialog leaves it out of its layout.
        this._hideEmptyBanner(dialog);

        // the clock, the prompt and the rows in the Tahoe proportions for this monitor
        buildLayout(this, dialog);
        // the time and date in Liquid Glass, as on the lock screen
        buildClock(this);
        // the weather and the month on the left, as on the lock screen
        buildWidgets(this, this.dir);

        // the password capsule: glass under the entry, in the entry's own BinLayout slot (GNOME
        // swaps the password and text entries in that slot with replace_child, which keeps ours)
        this._addPane(entryArea, 0, background, 'capsule');

        // the account rows: each row's content goes into a BinLayout box over a glass pill
        for (const item of userList._items.values())
            this._glassRow(item, background);
        const id = userList.connect('item-added', (list, item) => {
            try {
                this._glassRow(item, background);
            } catch (e) {
                this._fail(`row: ${e}`);
            }
        });
        this._undo.push(() => userList.disconnect(id));
    }

    _hideEmptyBanner(dialog) {
        const banner = dialog._bannerView;
        const label = dialog._bannerLabel;
        if (!banner || !label)
            return;
        let wanted = banner.visible;   // what GNOME last asked for, put back on undo
        let ours = false;
        const sync = () => {
            if (ours)
                return;
            if (!label.text && banner.visible) {
                wanted = true;
                ours = true;
                banner.hide();
                ours = false;
            } else if (!ours) {
                wanted = banner.visible;
            }
        };
        const ids = [
            banner.connect('notify::visible', sync),
            label.connect('notify::text', () => {
                if (label.text && wanted && !banner.visible)
                    banner.show();
                sync();
            }),
        ];
        sync();
        this._undo.push(() => {
            banner.disconnect(ids[0]);
            label.disconnect(ids[1]);
            if (wanted && !banner.visible)
                banner.show();
        });
    }

    _addPane(parent, index, background, radius) {
        const pane = new GlassPane(background, radius);
        parent.insert_child_at_index(pane, index);
        let gone = false;
        pane.connect('destroy', () => (gone = true));
        pane.connect('mask-failed', () => this._fail(`glass mask: ${pane.failed}`));
        this._undo.push(() => gone || pane.destroy());
        return pane;
    }

    _glassRow(item, background) {
        const content = item.child;
        if (!content || item._tahoeGdmRow)
            return;
        const box = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        item.set_child(null);
        box.add_child(content);
        // the row's padding moves onto its content (stylesheet.css: the row has none), so the
        // glass covers the whole row and its hover fill is the same pill
        content.add_style_class_name('tahoe-gdm-row-content');
        item.set_child(box);
        item._tahoeGdmRow = true;
        this._addPane(box, 0, background, 'capsule');
        let gone = false;
        item.connect('destroy', () => (gone = true));
        this._undo.push(() => {
            if (gone || item._tahoeGdmRow === undefined)
                return;
            delete item._tahoeGdmRow;
            content.remove_style_class_name('tahoe-gdm-row-content');
            box.remove_child(content);
            item.set_child(content);
            box.destroy();
        });
    }
}
