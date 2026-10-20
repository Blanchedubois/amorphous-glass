// Workshop only (docs/GDM_PLAN.md, widgets): tahoe-widgets' weather and calendar widgets on the
// lock screen (session mode unlock-dialog) and on the login screen (gdm), each on a Liquid Glass
// pane (tahoe-gdm glass.js, no Blur My Shell). tools/gdm/widgets-test.sh copies the widget modules
// in. WIDGETS_TEST="weather-small calendar-day ..." picks the row; WIDGETS_TEST_Y the top (px).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPane} from './paneglass.js';
import {WeatherSmall, WeatherMedium} from './weather.js';
import {CalendarDay, CalendarMonth, CalendarMedium} from './calendar.js';

const KINDS = {
    'weather-small': [WeatherSmall, 170, 170], 'weather-medium': [WeatherMedium, 356, 170],
    'calendar-day': [CalendarDay, 170, 170], 'calendar-month': [CalendarMonth, 170, 170],
    'calendar-medium': [CalendarMedium, 356, 170],
};
const GAP = 16;

function findBelow(root, styleClass) {
    // the bottom of the lowest mapped actor with this style class (the lock screen's Now Playing)
    let bottom = 0;
    const walk = a => {
        if (a.has_style_class_name?.(styleClass) && a.mapped) {
            const [, y] = a.get_transformed_position();
            bottom = Math.max(bottom, y + a.height);
        }
        a.get_children().forEach(walk);
    };
    walk(root);
    return bottom;
}

export default class {
    enable() {
        this._widgets = [];
        this._timer = GLib.timeout_add(0, Number(GLib.getenv("WIDGETS_TEST_DELAY") || 2500), () => {
            this._timer = 0;
            try { this._build(); } catch (e) { console.warn(`widgets-test: ${e}\n${e.stack}`); }
            return false;
        });
    }

    _build() {
        // WIDGETS_TEST_LOCATION: a fixed weather location (org.gnome.shell.weather locations, as
        // GVariant text), set in this throwaway shell's own settings before the weather client starts
        const location = GLib.getenv('WIDGETS_TEST_LOCATION');
        if (location) {
            const settings = new Gio.Settings({schema_id: 'org.gnome.shell.weather'});
            settings.set_boolean('automatic-location', false);
            settings.set_value('locations', GLib.Variant.parse(null, location, null, null));
        }
        const group = Main.screenShield._lockDialogGroup;
        const dialog = Main.screenShield._dialog;
        const locked = Main.sessionMode.currentMode === 'unlock-dialog';
        // lock screen: clone GNOME's lock background; login screen: the theme's picture
        const backdrop = locked
            ? dialog._backgroundGroup.get_first_child()
            : group.get_theme_node().get_background_image();
        const kinds = (GLib.getenv('WIDGETS_TEST') ?? 'weather-small calendar-day').split(/\s+/).filter(k => KINDS[k]);
        const monitor = Main.layoutManager.primaryMonitor;
        const total = kinds.reduce((w, k) => w + KINDS[k][1], 0) + GAP * (kinds.length - 1);
        let y = Number(GLib.getenv('WIDGETS_TEST_Y') || 0);
        if (!y)
            y = locked ? Math.max(423, findBelow(group, 'tahoe-widget') + 24) : 423;
        this._row = new St.Widget({layout_manager: new Clutter.FixedLayout(), reactive: false});
        group.add_child(this._row);
        let x = monitor.x + Math.round((monitor.width - total) / 2);
        const now = GLib.DateTime.new_now_local();
        for (const k of kinds) {
            const [cls, w, h] = KINDS[k];
            const card = new St.Widget({
                style_class: `tahoe-widget tahoe-widget-${k}`,
                layout_manager: new Clutter.BinLayout(), width: w, height: h, x, y,
            });
            card.add_child(new GlassPane(backdrop, 24));
            const content = new St.Widget({style_class: 'tahoe-widget-content', style: 'border-width: 0;', layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
            const widget = new cls();
            content.add_child(widget.actor);
            card.add_child(content);
            this._row.add_child(card);
            widget.tick(now);
            this._widgets.push(widget);
            x += w + GAP;
        }
        this._tick = GLib.timeout_add_seconds(0, 1, () => {
            const t = GLib.DateTime.new_now_local();
            this._widgets.forEach(wd => wd.tick(t));
            return true;
        });
    }

    disable() {
        if (this._timer) GLib.source_remove(this._timer);
        if (this._tick) GLib.source_remove(this._tick);
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
        this._row?.destroy();
        this._row = null;
    }
}
