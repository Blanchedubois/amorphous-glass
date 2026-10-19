// The Control Center panel: macOS Tahoe's layout, measured from the reference
// (docs/gnome-tahoe/menu-bar-control-center.md): 320 wide, two 137 px columns 18 apart, 12
// between rows; pills 137 x 80 (radius 40), circles 62 (radius 31), the player card 137 x 152
// and the slider cards 292 x 96 (radius 28), the Edit pill 28 tall (radius 15).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {Player} from './mpris.js';
import {attachGlass, loadBms} from './glass.js';

const PANEL_W = 320;
const PAD = 14;
const COL_GAP = 18;
const COL_W = (PANEL_W - PAD * 2 - COL_GAP) / 2; // 137
const ROW_GAP = 12;
const PILL_H = 80;
const CIRCLE = 62;

const CARD_H = 96;
const EDIT_H = 28;
const R = {pill: 40, circle: 31, card: 28, edit: 15};

const STATE_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass', 'state']);

function glassMode() {
    try {
        const [, bytes] = GLib.file_get_contents(STATE_FILE);
        return new TextDecoder().decode(bytes).split('\n').filter(l => l.startsWith('mode=')).pop()?.slice(5) ?? 'dark';
    } catch {
        return 'dark';
    }
}

function label(text, styleClass) {
    const l = new St.Label({text, style_class: styleClass, x_align: Clutter.ActorAlign.START});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// Every piece is a button with a BinLayout: Blur My Shell's glass goes in at index 0, the fill
// layer above it carries the hairline, the fallback fill and the "on" white, the content on top.
function makeShell(styleClass, width, height, content) {
    const btn = new St.Button({style_class: `tahoe-cc-piece ${styleClass}`, can_focus: true, width, height});
    const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
    const fill = new St.Widget({style_class: 'tahoe-cc-fill', x_expand: true, y_expand: true});
    stack.add_child(fill);
    stack.add_child(content);
    btn.set_child(stack);
    return {btn, fill, content};
}

// [circle glyph] Title / subtitle
function makePill(iconName, title, subtitle) {
    const box = new St.BoxLayout({style_class: 'tahoe-cc-pill-box', y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
    const icon = new St.Icon({style_class: 'tahoe-cc-pill-glyph', icon_name: iconName});
    const circle = new St.Bin({style_class: 'tahoe-cc-pill-circle', child: icon, y_align: Clutter.ActorAlign.CENTER});
    box.add_child(circle);
    const texts = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const t = label(title, 'tahoe-cc-title');
    texts.add_child(t);
    let s = null;
    if (subtitle !== null) {
        s = label(subtitle, 'tahoe-cc-subtitle');
        texts.add_child(s);
    }
    box.add_child(texts);
    const {btn} = makeShell('tahoe-cc-pill', COL_W, PILL_H, box);
    return {btn, icon, circle, title: t, subtitle: s};
}

function makeCircle(iconName) {
    const icon = new St.Icon({style_class: 'tahoe-cc-circle-icon', icon_name: iconName,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    const {btn} = makeShell('tahoe-cc-circle', CIRCLE, CIRCLE, icon);
    return {btn, icon};
}

function setOn(actor, on) {
    if (on)
        actor.add_style_class_name('on');
    else
        actor.remove_style_class_name('on');
}

// Tahoe's slider: an elongated white handle instead of the round dot
const TahoeSlider = GObject.registerClass(
class TahoeSlider extends Slider {
    vfunc_repaint() {
        Object.getPrototypeOf(Slider.prototype).vfunc_repaint.call(this);
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const h = 2 * this._handleRadius;
        const w = Math.round(h * 1.7);
        let x = w / 2 + (width - w) * this._value / this._maxValue;
        if (this.get_text_direction() === Clutter.TextDirection.RTL)
            x = width - x;
        const r = h / 2;
        cr.setSourceColor(this.get_theme_node().get_foreground_color());
        cr.arc(x - w / 2 + r, height / 2, r, Math.PI / 2, Math.PI * 1.5);
        cr.arc(x + w / 2 - r, height / 2, r, -Math.PI / 2, Math.PI / 2);
        cr.fill();
        cr.$dispose();
    }
});

function makeSliderCard(title, leftIcon, rightIcon, withEndButton) {
    const inner = new St.BoxLayout({style_class: 'tahoe-cc-card-inner', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
    inner.add_child(label(title, 'tahoe-cc-card-label'));
    const row = new St.BoxLayout({style_class: 'tahoe-cc-card-row', y_expand: true, y_align: Clutter.ActorAlign.CENTER});
    row.add_child(new St.Icon({style_class: 'tahoe-cc-endicon-small', icon_name: leftIcon, y_align: Clutter.ActorAlign.CENTER}));
    const slider = new TahoeSlider(0);
    slider.add_style_class_name('tahoe-cc-slider');
    slider.x_expand = true;
    row.add_child(slider);
    const icon = new St.Icon({style_class: 'tahoe-cc-endicon', icon_name: rightIcon, y_align: Clutter.ActorAlign.CENTER});
    row.add_child(icon);
    let endBtn = null;
    if (withEndButton) {
        endBtn = new St.Button({style_class: 'tahoe-cc-endbtn', can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        endBtn.set_child(new St.Icon({style_class: 'tahoe-cc-endbtn-icon', icon_name: 'audio-volume-muted-symbolic',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(endBtn);
    }
    inner.add_child(row);
    const {btn: box} = makeShell('tahoe-cc-card', PANEL_W - PAD * 2, CARD_H, inner);
    box.can_focus = false;
    return {box, slider, icon, endBtn};
}

function spacerRow(left, right) {
    const row = new St.BoxLayout({width: COL_W});
    row.add_child(left);
    row.add_child(new St.BoxLayout({x_expand: true}));
    row.add_child(right);
    return row;
}

function openSettings(panel) {
    const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop');
    if (!app)
        return;
    if (panel)
        app.activate_action('launch-panel', new GLib.Variant('(sav)', [panel, []]), 0, -1, null);
    else
        app.activate();
}

export class ControlCenter {
    constructor(openOriginal) {
        this._openOriginal = openOriginal;
        this._signals = [];
        this._destroyGlass = null;
        const monitor = Main.layoutManager.primaryMonitor;
        const panelH = Main.layoutManager.panelBox.height;

        this.overlay = new St.Widget({reactive: true, x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height});
        this.overlay.connect('button-press-event', (actor, event) => {
            if (global.stage.get_event_actor(event) === actor)
                this.close();
            return Clutter.EVENT_PROPAGATE;
        });
        this.overlay.connect('key-press-event', (a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const mode = glassMode();
        this.box = new St.BoxLayout({style_class: `tahoe-cc tahoe-cc-${mode}`, orientation: Clutter.Orientation.VERTICAL, width: PANEL_W});
        this.box.set_position(monitor.width - PANEL_W - 12, panelH + 10);
        this.overlay.add_child(this.box);
        this.pieces = [];
        this._build();
        Main.layoutManager.uiGroup.add_child(this.overlay);
        Main.layoutManager.uiGroup.set_child_below_sibling(this.overlay, Main.layoutManager.panelBox);
        this.overlay.grab_key_focus();
        this.box.opacity = 0;
        this.box.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        loadBms().then(lib => {
            if (lib && this.overlay)
                this._destroyGlass = attachGlass(lib, this.pieces);
        }).catch(e => console.warn(`[tahoe-cc] glass: ${e}`));
    }

    _piece(actor, radius) {
        this.pieces.push({actor, radius});
        return actor;
    }

    _build() {
        const cols = new St.BoxLayout({style_class: 'tahoe-cc-cols'});
        const left = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'tahoe-cc-col', width: COL_W});
        const right = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'tahoe-cc-col', width: COL_W});
        cols.add_child(left);
        cols.add_child(right);
        this.box.add_child(cols);

        // left: Wi-Fi, Bluetooth, AirDrop
        this.wifi = makePill('network-wireless-symbolic', 'Wi-Fi', 'Off');
        this.wifi.btn.connect('clicked', () => this._toggleWifi());
        left.add_child(this._piece(this.wifi.btn, R.pill));
        this.bt = makePill('bluetooth-active-symbolic', 'Bluetooth', 'Off');
        this.bt.btn.connect('clicked', () => this._toggleBluetooth());
        left.add_child(this._piece(this.bt.btn, R.pill));
        this.air = makePill('send-to-symbolic', 'AirDrop', 'Off');
        this.air.btn.connect('clicked', () => {
            this._airOn = !this._airOn;
            this.air.subtitle.text = this._airOn ? 'On' : 'Off';
            setOn(this.air.btn, this._airOn);
        });
        left.add_child(this._piece(this.air.btn, R.pill));

        // right: the player card, then Dark Style and the windows circle
        this._buildPlayer(right);
        this.dark = makeCircle('weather-clear-night-symbolic');
        this.dark.btn.connect('clicked', () => {
            const s = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            const dark = s.get_string('color-scheme') === 'prefer-dark';
            s.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
            this._syncDark();
        });
        this.stage = makeCircle('view-grid-symbolic');
        this.stage.btn.connect('clicked', () => {
            this.close();
            Main.overview.toggle();
        });
        right.add_child(spacerRow(this._piece(this.dark.btn, R.circle), this._piece(this.stage.btn, R.circle)));
        this._syncDark();

        // row: Displays and Screenshot circles, Focus pill
        const row = new St.BoxLayout({style_class: 'tahoe-cc-cols'});
        this.mirror = makeCircle('video-display-symbolic');
        this.mirror.btn.add_style_class_name('accent');
        this.mirror.btn.connect('clicked', () => {
            this.close();
            openSettings('display');
        });
        this.shot = makeCircle('camera-photo-symbolic');
        this.shot.btn.connect('clicked', () => {
            this.close();
            Main.screenshotUI.open().catch(() => {});
        });
        row.add_child(spacerRow(this._piece(this.mirror.btn, R.circle), this._piece(this.shot.btn, R.circle)));
        this.focus = makePill('weather-clear-night-symbolic', 'Focus', null);
        this.focus.btn.height = CIRCLE;
        this.focus.btn.connect('clicked', () => {
            const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            s.set_boolean('show-banners', !s.get_boolean('show-banners'));
            this._syncFocus();
        });
        row.add_child(this._piece(this.focus.btn, R.circle));
        this.box.add_child(row);
        this._syncFocus();

        // Display and Sound cards
        this.display = makeSliderCard('Display', 'display-brightness-symbolic', 'display-brightness-symbolic', false);
        this.box.add_child(this._piece(this.display.box, R.card));
        this._bindBrightness();
        this.sound = makeSliderCard('Sound', 'audio-volume-low-symbolic', 'audio-volume-high-symbolic', true);
        this.box.add_child(this._piece(this.sound.box, R.card));
        this._bindVolume();

        // Edit pill
        const editRow = new St.BoxLayout({x_expand: true});
        editRow.add_child(new St.BoxLayout({x_expand: true}));
        this.edit = makeShell('tahoe-cc-edit', 76, EDIT_H,
            new St.Label({text: 'Edit', style_class: 'tahoe-cc-edit-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER})).btn;
        this.edit.connect('clicked', () => {
            this.close();
            this._openOriginal?.();
        });
        editRow.add_child(this._piece(this.edit, R.edit));
        editRow.add_child(new St.BoxLayout({x_expand: true}));
        this.box.add_child(editRow);

        this._bindNetwork();
        this._bindBluetooth();
    }

    _buildPlayer(column) {
        const box = new St.BoxLayout({style_class: 'tahoe-cc-player-inner', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
        const {btn: card} = makeShell('tahoe-cc-player', COL_W, PILL_H * 2 + ROW_GAP, box);
        card.can_focus = false;
        this.artIcon = new St.Icon({style_class: 'tahoe-cc-art-icon', icon_name: 'emblem-music-symbolic',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.art = new St.Bin({style_class: 'tahoe-cc-art', child: this.artIcon, x_align: Clutter.ActorAlign.START});
        box.add_child(this.art);
        this.track = label('Not Playing', 'tahoe-cc-track');
        box.add_child(this.track);
        this.artist = label('', 'tahoe-cc-artist');
        this.artist.visible = false;
        box.add_child(this.artist);
        box.add_child(new St.BoxLayout({y_expand: true}));
        const ctl = new St.BoxLayout({style_class: 'tahoe-cc-transport', x_expand: true});
        const glyph = (name, method) => {
            const b = new St.Button({style_class: 'tahoe-cc-transport-btn', can_focus: true, x_expand: true});
            const i = new St.Icon({style_class: 'tahoe-cc-transport-icon', icon_name: name,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            b.set_child(i);
            b.connect('clicked', () => this._player.call(method));
            ctl.add_child(b);
            return i;
        };
        glyph('media-skip-backward-symbolic', 'Previous');
        this.playIcon = glyph('media-playback-start-symbolic', 'PlayPause');
        this.playIcon.add_style_class_name('play');
        glyph('media-skip-forward-symbolic', 'Next');
        box.add_child(ctl);
        column.add_child(this._piece(card, R.card));
        this._player = new Player(() => this._syncPlayer());
        this._artUrl = '';
    }

    _syncPlayer() {
        if (!this.overlay)
            return;
        const s = this._player.state;
        this.track.text = s ? (s.title || s.name) : 'Not Playing';
        this.artist.text = s?.artist ?? '';
        this.artist.visible = !!s?.artist;
        this.playIcon.icon_name = s?.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        const url = s?.artUrl ?? '';
        if (url === this._artUrl)
            return;
        this._artUrl = url;
        let file = null;
        if (url.startsWith('file://') || url.startsWith('/'))
            file = url.startsWith('/') ? Gio.File.new_for_path(url) : Gio.File.new_for_uri(url);
        else if (url.startsWith('http'))
            file = Gio.File.new_for_uri(url);
        if (file)
            this.art.set_child(new St.Icon({gicon: new Gio.FileIcon({file}), icon_size: 44, style_class: 'tahoe-cc-art-image'}));
        else
            this.art.set_child(this.artIcon);
    }

    _bindNetwork() {
        this._nm = null;
        import('gi://NM').then(({default: NM}) => {
            NM.Client.new_async(null, (o, res) => {
                try {
                    this._nm = NM.Client.new_finish(res);
                } catch {
                    return;
                }
                if (!this.overlay)
                    return;
                for (const prop of ['wireless-enabled', 'primary-connection', 'active-connections'])
                    this._signals.push([this._nm, this._nm.connect(`notify::${prop}`, () => this._syncWifi())]);
                this._syncWifi();
            });
        }).catch(() => {});
    }

    _syncWifi() {
        if (!this.overlay || !this._nm)
            return;
        const on = this._nm.wireless_enabled;
        const conn = on ? this._nm.get_primary_connection() : null;
        this.wifi.subtitle.text = conn?.get_id?.() ?? (on ? 'On' : 'Off');
        this.wifi.icon.icon_name = on ? 'network-wireless-symbolic' : 'network-wireless-disabled-symbolic';
        setOn(this.wifi.btn, on);
    }

    _toggleWifi() {
        if (this._nm)
            this._nm.wireless_enabled = !this._nm.wireless_enabled;
    }

    _bindBluetooth() {
        import('gi://GnomeBluetooth').then(({default: GnomeBluetooth}) => {
            this._bt = new GnomeBluetooth.Client();
            for (const prop of ['default-adapter-powered', 'default-adapter'])
                this._signals.push([this._bt, this._bt.connect(`notify::${prop}`, () => this._syncBluetooth())]);
            this._syncBluetooth();
        }).catch(() => {
            this.bt.subtitle.text = 'Unavailable';
        });
    }

    _syncBluetooth() {
        if (!this.overlay || !this._bt)
            return;
        const on = !!this._bt.default_adapter_powered;
        this.bt.subtitle.text = on ? 'On' : 'Off';
        this.bt.icon.icon_name = on ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        setOn(this.bt.btn, on);
    }

    _toggleBluetooth() {
        if (this._bt)
            this._bt.default_adapter_powered = !this._bt.default_adapter_powered;
    }

    _syncDark() {
        const s = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        setOn(this.dark.btn, s.get_string('color-scheme') === 'prefer-dark');
    }

    _syncFocus() {
        const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        setOn(this.focus.btn, !s.get_boolean('show-banners'));
    }

    _bindBrightness() {
        const {slider, box} = this.display;
        try {
            const proxy = Gio.DBusProxy.new_sync(Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
                'org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power/Screen',
                'org.gnome.SettingsDaemon.Power.Screen', null);
            const read = () => proxy.get_cached_property('Brightness')?.unpack() ?? -1;
            if (read() < 0) {
                box.opacity = 140;
                slider.reactive = false;
                return;
            }
            let guard = false;
            const sync = () => {
                guard = true;
                slider.value = read() / 100;
                guard = false;
            };
            sync();
            this._signals.push([proxy, proxy.connect('g-properties-changed', sync)]);
            slider.connect('notify::value', () => {
                if (!guard)
                    proxy.set_cached_property('Brightness', GLib.Variant.new_int32(Math.round(slider.value * 100)));
                if (!guard)
                    Gio.DBus.session.call('org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power/Screen',
                        'org.freedesktop.DBus.Properties', 'Set',
                        new GLib.Variant('(ssv)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness',
                            GLib.Variant.new_int32(Math.round(slider.value * 100))]),
                        null, Gio.DBusCallFlags.NONE, -1, null, null);
            });
        } catch {
            box.opacity = 140;
            slider.reactive = false;
        }
    }

    _bindVolume() {
        const {slider, icon, endBtn} = this.sound;
        import('gi://Gvc').then(({default: Gvc}) => {
            const control = new Gvc.MixerControl({name: 'Tahoe Control Center'});
            this._mixer = control;
            control.open();
            let guard = false;
            const sync = () => {
                const sink = control.get_default_sink();
                if (!sink || !this.overlay)
                    return;
                guard = true;
                slider.value = Math.max(0, Math.min(1, sink.volume / control.get_vol_max_norm()));
                guard = false;
                icon.icon_name = sink.is_muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
                endBtn.opacity = sink.is_muted ? 140 : 255;
            };
            const bind = () => {
                const sink = control.get_default_sink();
                if (!sink)
                    return;
                this._signals.push([sink, sink.connect('notify::volume', sync)], [sink, sink.connect('notify::mute', sync)]);
                sync();
            };
            this._signals.push([control, control.connect('state-changed', () => {
                if (control.get_state() === Gvc.MixerControlState.READY)
                    bind();
            })], [control, control.connect('default-sink-changed', bind)]);
            if (control.get_state() === Gvc.MixerControlState.READY)
                bind();
            slider.connect('notify::value', () => {
                const sink = control.get_default_sink();
                if (guard || !sink)
                    return;
                sink.volume = Math.round(slider.value * control.get_vol_max_norm());
                if (sink.is_muted && slider.value > 0)
                    sink.is_muted = false;
                sink.push_volume();
            });
            endBtn.connect('clicked', () => {
                const sink = control.get_default_sink();
                if (sink)
                    sink.is_muted = !sink.is_muted;
            });
        }).catch(() => {
            this.sound.box.opacity = 140;
        });
    }

    close() {
        if (!this.overlay)
            return;
        const overlay = this.overlay;
        this.overlay = null;
        for (const [obj, id] of this._signals) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._signals = [];
        this._player?.destroy();
        this._mixer?.close();
        this._destroyGlass?.();
        overlay.destroy();
        this.onClosed?.();
    }
}
