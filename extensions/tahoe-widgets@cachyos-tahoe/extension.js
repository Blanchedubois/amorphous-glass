// Tahoe Widgets: Liquid Glass widgets on the desktop layer, above the wallpaper and below windows.
//
// Right-click the desktop (or a widget) for Add Widget; drag a widget to move it, it snaps to an
// 8 px grid. The layout lives in ~/.config/tahoe-glass/widgets.json. The top bar is never touched.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {GlassCard, STATE_FILE, bmsUuid, glassMode, loadBms, scaleFactor} from './glass.js';
import {AnalogClock, AnalogMarksClock, AnalogQuartersClock, DateTimeClock, DigitalClock} from './clocks.js';
import {GlassTextClock} from './glasstext.js';
import {CalendarDay, CalendarMedium, CalendarMonth} from './calendar.js';
import {ScheduleLarge, ScheduleSmall} from './schedule.js';
import {MusicExtraLargeTall, MusicExtraLargeWide, MusicLarge, MusicLyrics, MusicMedium, MusicSmall} from './music.js';
import {WeatherLarge, WeatherMedium, WeatherSmall} from './weather.js';

const LAYOUT_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass', 'widgets.json']);
const GRID = 8;   // logical px
const GAP = 16;   // between widgets, logical px
// Tahoe widget sizes, logical px
const SIZES = {small: [170, 170], medium: [356, 170], large: [356, 356]};
// a widget class can set its own width and height (static width / height, logical px) over its
// size: the Large and Extra Large Music widgets
const dims = cls => [cls.width ?? SIZES[cls.size][0], cls.height ?? SIZES[cls.size][1]];

const TYPES = {
    'clock-analog': {name: 'Analog Clock', cls: AnalogClock},
    'clock-analog-marks': {name: 'Analog Clock: Marks', cls: AnalogMarksClock},
    'clock-analog-quarters': {name: 'Analog Clock: Quarters', cls: AnalogQuartersClock},
    'clock-digital': {name: 'Digital Clock', cls: DigitalClock},
    'clock-datetime': {name: 'Date & Time', cls: DateTimeClock},
    'clock-glass-text': {name: 'Glass Text Clock', cls: GlassTextClock},
    'calendar-day': {name: 'Calendar: Today', cls: CalendarDay},
    'calendar-month': {name: 'Calendar: Month', cls: CalendarMonth},
    'calendar-medium': {name: 'Calendar: Today and Month', cls: CalendarMedium},
    'schedule-small': {name: 'Calendar: Schedule', cls: ScheduleSmall},
    'schedule-large': {name: 'Calendar: Schedule Large', cls: ScheduleLarge},
    'weather-small': {name: 'Weather', cls: WeatherSmall},
    'weather-medium': {name: 'Weather: Next Hours', cls: WeatherMedium},
    'weather-large': {name: 'Weather: Week', cls: WeatherLarge},
    'music-small': {name: 'Music', cls: MusicSmall},
    'music-medium': {name: 'Music: Wide', cls: MusicMedium},
    'music-large': {name: 'Music: Large', cls: MusicLarge},
    'music-lyrics': {name: 'Music: Lyrics', cls: MusicLyrics},
    'music-xl-wide': {name: 'Music: Extra Large Wide', cls: MusicExtraLargeWide},
    'music-xl-tall': {name: 'Music: Extra Large Tall', cls: MusicExtraLargeTall},
};

const DEFAULT_LAYOUT = [
    {type: 'clock-datetime', x: 40, y: 64},
    {type: 'clock-analog', x: 40, y: 64 + 170 + GAP},
    {type: 'clock-digital', x: 40 + 170 + GAP, y: 64 + 170 + GAP},
];

const snap = v => Math.round(v / GRID) * GRID;

function loadLayout() {
    try {
        const [, bytes] = GLib.file_get_contents(LAYOUT_FILE);
        const list = JSON.parse(new TextDecoder().decode(bytes)).widgets;
        if (Array.isArray(list))
            return list.filter(w => TYPES[w.type]);
    } catch {}
    return DEFAULT_LAYOUT.map(w => ({...w}));
}

export default class TahoeWidgets extends Extension {
    enable() {
        this._entries = [];
        this._mode = glassMode();
        this._lib = null;

        this._menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0, St.Side.TOP);
        this._menu.actor.add_style_class_name('background-menu');
        this._removeItem = this._menu.addAction('Remove Widget', () => this._remove(this._menuEntry));
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addTypeItems(this._menu);
        Main.layoutManager.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(Main.layoutManager.dummyCursor);
        this._menuManager.addMenu(this._menu);

        for (const spec of loadLayout())
            this._create(spec);

        this._stateMonitor = Gio.File.new_for_path(STATE_FILE).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._stateMonitor.connect('changed', () => this._applyMode());
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interface.connectObject('changed::clock-format', () => this._tick(), this);

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._relayout();
            this._hookBackgroundMenus();
            this._rebuildGlass();
        }, this);
        // Blur My Shell restarts around the lock screen: rebuild on its new managers
        Main.extensionManager.connectObject('extension-state-changed', (_m, ext) => {
            if (ext.uuid === bmsUuid())
                this._rebuildGlass();
        }, this);

        global.display.connectObject('in-fullscreen-changed', () => this._tick(), this);

        this._bgMenuItems = [];
        this._hookBackgroundMenus();
        this._rebuildGlass();
        this._tick();
    }

    // ---- widgets ----

    _create(spec) {
        const def = TYPES[spec.type];
        const monitorIndex = Main.layoutManager.monitors[spec.monitor ?? -1]
            ? spec.monitor : Main.layoutManager.primaryIndex;
        const card = new GlassCard(monitorIndex, {bare: Boolean(def.cls.bare)});
        card.actor.add_style_class_name(`tahoe-widget-${spec.type}`);
        card.setMode(this._mode);
        const widget = new def.cls();
        widget.setMode(this._mode);
        card.content.add_child(widget.actor);
        widget.attachCard?.(card);
        // a widget that starts or stops showing seconds (music playing) asks for the next tick now
        widget.requestTick = () => this._tickSoon();
        const entry = {spec: {...spec, monitor: monitorIndex}, card, widget};
        this._entries.push(entry);

        // above the wallpaper, below every window
        Main.layoutManager._backgroundGroup.add_child(card.actor);
        this._place(entry);
        this._addGestures(entry);
        card.setGlass(this._lib);
        widget.tick(GLib.DateTime.new_now_local());
        return entry;
    }

    _place(entry) {
        const monitor = Main.layoutManager.monitors[entry.card.monitorIndex];
        const scale = scaleFactor();
        const [w, h] = dims(entry.widget.constructor);
        entry.card.actor.set_size(w * scale, h * scale);
        entry.card.actor.set_position(monitor.x + entry.spec.x * scale, monitor.y + entry.spec.y * scale);
    }

    _relayout() {
        for (const entry of this._entries) {
            if (!Main.layoutManager.monitors[entry.card.monitorIndex])
                entry.card.monitorIndex = Main.layoutManager.primaryIndex;
            entry.spec.monitor = entry.card.monitorIndex;
            this._place(entry);
        }
    }

    _addGestures(entry) {
        const actor = entry.card.actor;
        const pan = new Clutter.PanGesture({required_button: Clutter.BUTTON_PRIMARY});
        let start = null;
        pan.connect('recognize', () => {
            actor.remove_all_transitions();   // still snapping from the last drop
            start = [actor.x, actor.y];
            actor.get_parent().set_child_above_sibling(actor, null);
            actor.add_style_class_name('tahoe-widget-dragging');
        });
        pan.connect('pan-update', () => {
            if (!start)
                return;
            const d = pan.get_accumulated_delta_abs();
            actor.set_position(start[0] + d.get_x(), start[1] + d.get_y());
        });
        pan.connect('end', () => {
            start = null;
            actor.remove_style_class_name('tahoe-widget-dragging');
            this._drop(entry);
        });
        pan.connect('cancel', () => {
            // back to its saved grid spot (where the drag started may be mid-snap)
            if (start)
                this._place(entry);
            start = null;
            actor.remove_style_class_name('tahoe-widget-dragging');
        });
        actor.add_action(pan);

        const click = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        click.connect('recognize', () => {
            const {x, y} = click.get_coords_abs();
            this._openMenu(entry, x, y);
        });
        actor.add_action(click);
    }

    // snap to the grid, inside the work area of the monitor the widget's centre is on
    _drop(entry) {
        const actor = entry.card.actor;
        const cx = actor.x + actor.width / 2, cy = actor.y + actor.height / 2;
        const monitors = Main.layoutManager.monitors;
        let index = monitors.findIndex(m => cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
        if (index < 0)
            index = entry.card.monitorIndex;
        const monitor = monitors[index];
        const area = Main.layoutManager.getWorkAreaForMonitor(index);
        const scale = scaleFactor();
        const [w, h] = dims(entry.widget.constructor);
        const minX = (area.x - monitor.x) / scale, minY = (area.y - monitor.y) / scale;
        // the far edges round down to the grid too, so a widget pushed against them stays on it
        const maxX = Math.floor((minX + area.width / scale - w) / GRID) * GRID;
        const maxY = Math.floor((minY + area.height / scale - h) / GRID) * GRID;
        const x = Math.min(Math.max(snap((actor.x - monitor.x) / scale), Math.ceil(minX / GRID) * GRID), maxX);
        const y = Math.min(Math.max(snap((actor.y - monitor.y) / scale), Math.ceil(minY / GRID) * GRID), maxY);
        entry.spec = {...entry.spec, x, y, monitor: index};
        entry.card.monitorIndex = index;
        actor.ease({
            x: monitor.x + x * scale,
            y: monitor.y + y * scale,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._save();
    }

    _remove(entry) {
        if (!entry)
            return;
        this._entries = this._entries.filter(e => e !== entry);
        entry.widget.destroy();
        entry.card.destroy();
        this._save();
    }

    // the first free grid spot from the top left of the primary monitor's work area
    _add(type, monitorIndex = Main.layoutManager.primaryIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const area = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        const scale = scaleFactor();
        const [w, h] = dims(TYPES[type].cls);
        const left = Math.ceil(((area.x - monitor.x) / scale + 40) / GRID) * GRID;
        const top = Math.ceil(((area.y - monitor.y) / scale + GAP) / GRID) * GRID;
        const right = (area.x - monitor.x + area.width) / scale - w;
        const bottom = (area.y - monitor.y + area.height) / scale - h;
        const taken = this._entries.filter(e => e.card.monitorIndex === monitorIndex).map(e => {
            const [ew, eh] = dims(e.widget.constructor);
            return [e.spec.x, e.spec.y, ew, eh];
        });
        const free = (x, y) => taken.every(([tx, ty, tw, th]) =>
            x + w + GAP <= tx || tx + tw + GAP <= x || y + h + GAP <= ty || ty + th + GAP <= y);
        let spot = [left, top];
        search: for (let x = left; x <= right; x += GRID) {
            for (let y = top; y <= bottom; y += GRID) {
                if (free(x, y)) {
                    spot = [x, y];
                    break search;
                }
            }
        }
        this._create({type, monitor: monitorIndex, x: spot[0], y: spot[1]});
        this._save();
        this._tickSoon();   // a new second hand starts at once
    }

    _save() {
        const widgets = this._entries.map(({spec}) =>
            ({type: spec.type, monitor: spec.monitor, x: spec.x, y: spec.y}));
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(LAYOUT_FILE), 0o755);
            GLib.file_set_contents(LAYOUT_FILE, `${JSON.stringify({widgets}, null, 2)}\n`);
        } catch (e) {
            console.warn(`tahoe-widgets: could not save the layout: ${e}`);
        }
    }

    // ---- menus ----

    _addTypeItems(menu, position) {
        const sub = new PopupMenu.PopupSubMenuMenuItem('Add Widget');
        for (const [type, def] of Object.entries(TYPES))
            sub.menu.addAction(def.name, () => this._add(type));
        menu.addMenuItem(sub, position);
        return sub;
    }

    _openMenu(entry, x, y) {
        this._menuEntry = entry;
        this._removeItem.visible = Boolean(entry);
        Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
        this._menu.open();
    }

    // "Add Widget" at the top of the desktop's own right-click menu, on every monitor;
    // the shell rebuilds that menu with each new wallpaper
    _hookBackgroundMenus() {
        for (const bgManager of Main.layoutManager._bgManagers ?? []) {
            if (!bgManager._tahoeWidgetsHooked) {
                bgManager._tahoeWidgetsHooked = bgManager.connect('changed', () => this._hookBackgroundMenus());
                this._hookedManagers = [...(this._hookedManagers ?? []), bgManager];
            }
            const menu = bgManager.backgroundActor?._backgroundMenu;
            if (!menu || menu._tahoeWidgetsItems)
                continue;
            // inserted at the top, so the submenu opens under its own row
            const separator = new PopupMenu.PopupSeparatorMenuItem();
            menu.addMenuItem(separator, 0);
            const sub = this._addTypeItems(menu, 0);
            menu._tahoeWidgetsItems = [sub, separator];
            this._bgMenuItems.push(menu);
        }
    }

    _unhookBackgroundMenus() {
        for (const menu of this._bgMenuItems) {
            menu._tahoeWidgetsItems?.forEach(item => item.destroy());
            delete menu._tahoeWidgetsItems;
        }
        this._bgMenuItems = [];
        for (const bgManager of this._hookedManagers ?? []) {
            if (bgManager._tahoeWidgetsHooked)
                bgManager.disconnect(bgManager._tahoeWidgetsHooked);
            delete bgManager._tahoeWidgetsHooked;
        }
        this._hookedManagers = [];
    }

    // ---- mode, glass, time ----

    _applyMode() {
        this._mode = glassMode();
        for (const {card, widget} of this._entries) {
            card.setMode(this._mode);
            widget.setMode(this._mode);
        }
    }

    async _rebuildGlass() {
        const serial = this._serial = (this._serial ?? 0) + 1;
        let lib = null;
        try {
            lib = await loadBms();
        } catch (e) {
            console.warn(`tahoe-widgets: Blur My Shell glass unavailable: ${e}`);
        }
        if (serial !== this._serial || !this._entries)
            return;
        this._lib = lib;
        this._entries.forEach(e => e.card.setGlass(lib));
    }

    // Once a second, on the second, while a widget shows seconds (an analog face, music
    // playing); else once a minute, on the minute. Stopped while fullscreen windows cover every
    // monitor that has widgets: 'in-fullscreen-changed' starts it again.
    _tick() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        if (!this._entries || this._covered())
            return;
        const now = GLib.DateTime.new_now_local();
        this._entries.forEach(e => e.widget.tick(now));
        const seconds = this._entries.some(e => e.widget.wantsSeconds);
        const ms = Math.floor(now.get_microsecond() / 1000);
        const wait = seconds ? 1000 - ms + 5 : (60 - now.get_second()) * 1000 - ms + 5;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
            this._tickId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    // many requests in a row (a spammed play button) make one tick
    _tickSoon() {
        this._tickSoonId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._tickSoonId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _covered() {
        const monitors = new Set(this._entries.map(e => e.card.monitorIndex));
        return monitors.size > 0 &&
            [...monitors].every(i => Main.layoutManager.monitors[i]?.inFullscreen);
    }

    disable() {
        this._serial = (this._serial ?? 0) + 1;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        if (this._tickSoonId)
            GLib.source_remove(this._tickSoonId);
        this._tickSoonId = 0;
        Main.layoutManager.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);
        global.display.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._interface = null;
        this._stateMonitor.cancel();
        this._stateMonitor = null;
        this._unhookBackgroundMenus();
        this._menu.destroy();
        this._menu = null;
        this._menuManager = null;
        this._entries.forEach(e => {
            e.widget.destroy();
            e.card.destroy();
        });
        this._entries = null;
        this._lib = null;
    }
}
