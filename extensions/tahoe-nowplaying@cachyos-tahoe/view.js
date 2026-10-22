// What the overlay shows (docs/NOWPLAYING_PLAN.md): the backdrop, the lock screen's glass clock,
// the player column, the lyrics and the chevron, placed by layout.js. The view only draws: player.js
// tells it what plays (set*), and it reports the controls (onControl).
//
// The backdrop has two layers: the wallpaper, blurred, and over it the cover's colours (Phase 4's
// swirl; until then a still gradient of the same colours). With no cover the colours fade away and
// the blurred wallpaper is the background (user, 2026-10-21), and the cover's place is a Liquid
// Glass card with a note. Every glass pane clones the backdrop.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClockPanes, clockMaterial, FONT as CLOCK_FONT} from './shared/clockpanes.js';
import {GlassPane} from './shared/paneglass.js';
import {LyricsView} from './shared/music.js';
import {geometry} from './layout.js';
import {setSymbol, symbolActor} from './symbols.js';

const WALLPAPER_BLUR = 60;        // logical px at 1440p
const WALLPAPER_BRIGHTNESS = 0.82;
const LYRIC_BLUR = 4;             // px for a line one away from the sung one (more further off)
const FADE_MS = 600;              // the cover's colours in or out over the wallpaper
const DISABLED = 0.4;             // a control the player does not offer

const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

// 12 h without AM/PM, as on the lock screen; 24 h as GNOME is set
function timeText(now) {
    const h24 = interfaceSettings.get_string('clock-format') === '24h';
    return now.format(h24 ? '%H:%M' : '%l:%M').trim();
}

const dateText = now => now.format('%a %b %-d');

function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const css = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(', ')})`;

export class NowPlayingView {
    // parent: the overlay actor (stage-sized); monitor: where the player goes; guard: the overlay's;
    // onControl: (name, value) => void for the controls; onChevron: () => void
    constructor(parent, monitor, {guard, onControl, onChevron}) {
        this._parent = parent;
        this._monitor = monitor;
        this._guard = guard;
        this._onControl = onControl;
        this._blend = 1;
        this._ink = [255, 255, 255];
        this._inked = [];   // [actor, alpha, extra css]: restyled when the ink changes
        this.parts = {};
        this.controls = {};

        this._buildBackdrop();
        const g = geometry(monitor, 1);
        this._u = g.u;
        this._buildClock(g);
        this._buildColumn(g);
        this._buildLyrics(g);
        this._buildChevron(g, onChevron);
        this.setBlend(1);
    }

    // ---- the backdrop: the blurred wallpaper, the cover's colours over it ----
    _buildBackdrop() {
        const backdrop = new St.Widget({name: 'tahoe-np-backdrop', reactive: false, layout_manager: new Clutter.FixedLayout()});
        backdrop.set_position(0, 0);
        backdrop.set_size(global.stage.width, global.stage.height);
        this._parent.add_child(backdrop);
        this.backdrop = backdrop;

        // every monitor's wallpaper (GNOME's own background actors, cloned), blurred
        const wallpaper = new St.Widget({name: 'tahoe-np-wallpaper', style_class: 'tahoe-np-wallpaper', reactive: false, layout_manager: new Clutter.FixedLayout()});
        wallpaper.set_size(global.stage.width, global.stage.height);
        for (const [i, monitor] of Main.layoutManager.monitors.entries()) {
            const source = Main.layoutManager._bgManagers?.[i]?.backgroundActor;
            if (!source)
                continue;
            const clone = new Clutter.Clone({source, reactive: false});
            clone.set_position(monitor.x, monitor.y);
            clone.set_size(monitor.width, monitor.height);
            wallpaper.add_child(clone);
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        wallpaper.add_effect_with_name('blur', new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: Math.round(WALLPAPER_BLUR * Math.max(0.5, this._monitor.height / 1440) * scale),
            brightness: WALLPAPER_BRIGHTNESS,
        }));
        backdrop.add_child(wallpaper);

        // the cover's colours (a stand-in for Phase 4's swirl), faded in only with a cover
        this._colours = new St.Widget({name: 'tahoe-np-colours', reactive: false, opacity: 0});
        this._colours.set_size(global.stage.width, global.stage.height);
        backdrop.add_child(this._colours);
    }

    // the cover's swirl palette (four sRGB colours 0..1), or null: the blurred wallpaper alone
    setColours(palette) {
        this.coloursOn = Boolean(palette);
        if (palette) {
            this._colours.set_style(`background-gradient-direction: vertical; background-gradient-start: ${css(palette[0])}; background-gradient-end: ${css(palette[2])};`);
        }
        this._colours.remove_all_transitions();
        this._colours.ease({opacity: palette ? 255 : 0, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
    }

    // ---- the clock: the lock screen's (ClockPanes, B2 clear blur), the plain labels under it ----
    _buildClock(g) {
        const layer = new St.Widget({name: 'tahoe-np-clock', reactive: false, layout_manager: new Clutter.FixedLayout()});
        layer.set_position(0, 0);
        layer.set_size(global.stage.width, global.stage.height);
        this._parent.add_child(layer);

        // the plain clock, shown only if the glass cannot be made
        const label = size => new St.Label({style: `font-family: "${CLOCK_FONT}"; font-size: ${size}px; color: rgba(255, 255, 255, 0.9);`, opacity: 0});
        this._plainDate = label(g.clock.dateSize);
        this._plainTime = label(g.clock.timeSize);
        layer.add_child(this._plainDate);
        layer.add_child(this._plainTime);

        this._clockFailed = false;
        this._clock = new ClockPanes(layer, this.backdrop, GlassPane, reason => this._guard(() => {
            if (this._clockFailed)
                return;
            this._clockFailed = true;
            console.warn(`tahoe-nowplaying: glass clock: ${reason}; showing the plain clock`);
            this._clock?.destroy();
            this._clock = null;
            this._plainDate.opacity = 255;
            this._plainTime.opacity = 255;
        }));

        const update = () => this._guard(() => this._updateClock(g.clock));
        this._wallClock = new GnomeDesktop.WallClock({time_only: true});
        this._wallClockId = this._wallClock.connect('notify::clock', update);
        this._formatId = interfaceSettings.connect('changed::clock-format', update);
        update();
    }

    _updateClock(c) {
        const now = GLib.DateTime.new_now_local();
        const date = dateText(now), time = timeText(now);
        this._plainDate.text = date;
        this._plainTime.text = time;
        // the plain labels by their line boxes, near enough (they show only without the glass)
        this._plainDate.set_position(c.left + Math.round((c.width - this._plainDate.width) / 2), c.dateTop - Math.round(c.dateSize * 0.28));
        this._plainTime.set_position(c.left + Math.round((c.width - this._plainTime.width) / 2), c.digitsTop - Math.round(c.timeSize * 0.27));
        if (!this._clock)
            return;
        this._clock.place('date', date, c.dateSize, c.dateTop, c.left, c.width, clockMaterial(c.timeSize, true));
        this._clock.place('time', time, c.timeSize, c.digitsTop, c.left, c.width, clockMaterial(c.timeSize, false));
    }

    get clockPaints() {
        return this._clock?.paints ?? 0;
    }

    get clockFailed() {
        return this._clockFailed;
    }

    // ---- the ink: the cover's (palette.js inkColour), white without one ----
    _inkedStyle(actor, alpha, extra = '', property = 'color') {
        this._inked.push([actor, alpha, extra, property]);
        this._applyInk(actor, alpha, extra, property);
    }

    _applyInk(actor, alpha, extra, property) {
        actor.set_style(`${extra}${property}: rgba(${this._ink.join(', ')}, ${alpha});`);
    }

    // rgb: sRGB 0..1, or null for white
    setInk(rgb) {
        this._ink = rgb ? rgb.map(v => Math.round(v * 255)) : [255, 255, 255];
        for (const [actor, alpha, extra, property] of this._inked)
            this._applyInk(actor, alpha, extra, property);
        const ink = this._ink;
        this._lyrics.setInk((a = 1) => `rgba(${ink.join(', ')}, ${a})`);
    }

    // ---- the column: cover, title, artist, progress, times, transport, volume ----
    _buildColumn(g) {
        const u = g.u;
        const column = new St.Widget({name: 'tahoe-np-column', reactive: false, layout_manager: new Clutter.FixedLayout()});
        this._parent.add_child(column);
        this._column = column;
        const b = g.boxes;
        const at = (actor, box, name) => {
            actor.set_position(box.x, box.y);
            actor.set_size(box.width, box.height);
            column.add_child(actor);
            this.parts[name] = actor;
            return actor;
        };

        // the cover: the art by itself (12 px corners, no shadow: St draws one as a square box behind
        // the rounded art); with none, a Liquid Glass card
        // with a note (the widgets' dark glass; Phase 5 puts the real glass under the CSS stand-in)
        const cover = at(new St.Widget({layout_manager: new Clutter.BinLayout()}), b.cover, 'cover');
        const radius = g.coverRadius;
        this._coverGlass = new St.Widget({
            style_class: 'tahoe-np-glass tahoe-np-cover-glass',
            style: `border-radius: ${radius}px;`,
            x_expand: true, y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        const note = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(b.cover.height * 0.3), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._inkedStyle(note, 0.7);
        this._coverGlass.add_child(note);
        cover.add_child(this._coverGlass);
        this._coverArt = new St.Widget({
            style_class: 'tahoe-np-cover-art',
            x_expand: true, y_expand: true,
            visible: false,
        });
        this._coverRadius = radius;
        cover.add_child(this._coverArt);

        const text = (string, extra, alpha) => {
            const l = new St.Label({text: string, style_class: 'tahoe-np-text'});
            l.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
            this._inkedStyle(l, alpha, `text-align: center; ${extra}`);
            return l;
        };
        this._title = at(text('Not Playing', `font-family: "SF Pro Display"; font-weight: 700; font-size: ${Math.round(42 * u)}px; `, 1), b.title, 'title');
        this._artist = at(text('', `font-family: "SF Pro Display"; font-weight: 500; font-size: ${Math.round(34 * u)}px; `, 0.72), b.artist, 'artist');

        // the widget's thin track: the ink at 0.22, the fill at 0.88; a click seeks
        const track = (box, name) => {
            const t = new St.Widget({reactive: true, layout_manager: new Clutter.FixedLayout()});
            const h = Math.max(4, Math.round(8 * u * g.k));
            t._bar = new St.Widget();
            t._fill = new St.Widget();
            this._inkedStyle(t._bar, 0.22, `border-radius: ${h / 2}px; `, 'background-color');
            this._inkedStyle(t._fill, 0.88, `border-radius: ${h / 2}px; `, 'background-color');
            t._bar.add_child(t._fill);
            t.add_child(t._bar);
            t._tahoeNpControl = true;
            t._h = h;
            this.parts[name] = t;
            return t;
        };
        // the progress: the bar in its row, the hit area a little taller than the bar
        const progress = track(b.progress, 'progress');
        const pad = Math.round(10 * u);
        progress.set_position(b.progress.x, b.progress.y - pad);
        progress.set_size(b.progress.width, b.progress.height + 2 * pad);
        progress._bar.set_position(0, pad);
        progress._bar.set_size(b.progress.width, b.progress.height);
        column.add_child(progress);
        progress.connect('button-release-event', (_a, event) => this._guard(() => {
            const [, x] = progress.transform_stage_point(...event.get_coords());
            this._onControl?.('seek-to', Math.min(1, Math.max(0, x / progress.width)));
            return Clutter.EVENT_STOP;
        }));
        this._progress = progress;
        this._setFill(progress, 0);

        const times = at(new St.Widget({layout_manager: new Clutter.BinLayout()}), b.times, 'times');
        const timeLabel = align => {
            const l = new St.Label({x_expand: true, x_align: align});
            this._inkedStyle(l, 0.72, `font-family: "SF Pro Text"; font-weight: 600; font-size: ${Math.round(21 * u)}px; `);
            times.add_child(l);
            return l;
        };
        this._elapsed = timeLabel(Clutter.ActorAlign.START);
        this._left = timeLabel(Clutter.ActorAlign.END);

        // the transport: SF Symbols floating, centred; [name, symbol, glyph px, hit px, fallback, alpha]
        const transport = at(new St.Widget({layout_manager: new Clutter.FixedLayout()}), b.transport, 'transport');
        const items = [
            ['shuffle', 'shuffle', 32, 64, 'media-playlist-shuffle-symbolic', 0.72],
            ['previous', 'backward.fill', 52, 96, 'media-skip-backward-symbolic', 1],
            ['play-pause', 'play.fill', 72, 112, 'media-playback-start-symbolic', 1],
            ['next', 'forward.fill', 52, 96, 'media-skip-forward-symbolic', 1],
            ['repeat', 'repeat', 32, 64, 'media-playlist-repeat-symbolic', 0.72],
        ];
        const k = g.k;
        const total = items.reduce((w, it) => w + it[3] * u * k, 0);
        const gap = (b.transport.width - total) / (items.length - 1);
        let x = 0;
        for (const [name, symbol, glyph, hit, fallback, alpha] of items) {
            const size = Math.round(hit * u * k);
            const button = this._control(name, symbolActor(symbol, Math.round(glyph * u * k), fallback), alpha);
            button._glyph = Math.round(glyph * u * k);
            button.set_size(size, size);
            button.set_position(Math.round(x), Math.round((b.transport.height - size) / 2));
            transport.add_child(button);
            x += size + gap;
        }

        // the volume: the system output's level on the same thin track, a speaker each end
        const volume = at(new St.Widget({layout_manager: new Clutter.FixedLayout()}), b.volume, 'volume');
        const end = Math.round(52 * u * k);   // wide enough for speaker.wave.3.fill
        const ends = [['speaker.fill', 'audio-volume-low-symbolic', 0], ['speaker.wave.3.fill', 'audio-volume-high-symbolic', b.volume.width - end]];
        for (const [symbol, fallback, left] of ends) {
            const box = new St.Bin({child: symbolActor(symbol, Math.round(26 * u * k), fallback), width: end, height: b.volume.height});
            this._inkedStyle(box, 0.72);
            box.set_position(left, 0);
            volume.add_child(box);
        }
        const vol = track(b.volume, 'volume-track');
        const vw = b.volume.width - 2 * (end + Math.round(8 * u));
        vol.set_position(end + Math.round(8 * u), 0);
        vol.set_size(vw, b.volume.height);
        vol._bar.set_position(0, Math.round((b.volume.height - vol._h) / 2));
        vol._bar.set_size(vw, vol._h);
        volume.add_child(vol);
        vol.connect('button-release-event', (_a, event) => this._guard(() => {
            const [, vx] = vol.transform_stage_point(...event.get_coords());
            this._onControl?.('volume-to', Math.min(1, Math.max(0, vx / vol.width)));
            return Clutter.EVENT_STOP;
        }));
        vol.connect('scroll-event', (_a, event) => this._guard(() => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP)
                this._onControl?.('volume-up');
            else if (dir === Clutter.ScrollDirection.DOWN)
                this._onControl?.('volume-down');
            return Clutter.EVENT_STOP;
        }));
        this._volume = vol;
        this._volumeRow = volume;
        this._setFill(vol, 0);
    }

    _setFill(track, fraction) {
        track._fill.set_size(Math.round(track._bar.width * Math.min(1, Math.max(0, fraction))), track._bar.height);
    }

    // a floating control: the symbol, no plate; hover is the widget's soft circle (stylesheet)
    _control(name, child, alpha) {
        const button = new St.Button({
            style_class: 'tahoe-np-control',
            can_focus: false,
            accessible_name: name,
            child,
        });
        this._inkedStyle(button, alpha);
        button._tahoeNpControl = true;
        button.connect('clicked', () => this._guard(() => this._onControl?.(name)));
        this.parts[`control-${name}`] = button;
        this.controls[name] = button;
        return button;
    }

    // ---- what plays ----

    // uri: a file uri for the art, or null: the glass card
    setCover(uri) {
        if (uri === this._coverUri)
            return;
        this._coverUri = uri;
        if (uri) {
            this._coverArt.set_style(`background-image: url("${uri.replace(/"/g, '%22')}"); background-size: cover; border-radius: ${this._coverRadius}px;`);
            this._coverArt.show();
            this._coverGlass.hide();
        } else {
            this._coverArt.hide();
            this._coverArt.set_style(null);
            this._coverGlass.show();
        }
    }

    get coverUri() {
        return this._coverUri ?? null;
    }

    setText(title, artist) {
        this._title.text = title;
        this._artist.text = artist;
    }

    setProgress(position, length) {
        this._setFill(this._progress, length > 0 ? position / length : 0);
        this._elapsed.text = length > 0 ? clock(position) : '';
        this._left.text = length > 0 ? `-${clock(length - position)}` : '';
    }

    // what the player offers: {player, playing, canPrev, canNext, canSeek, shuffle, loop}
    setControls(c) {
        const set = (name, enabled, visible = true) => {
            const b = this.controls[name];
            b.reactive = enabled;
            b.visible = visible;
            b.opacity = enabled ? 255 : Math.round(255 * DISABLED);
        };
        const play = this.controls['play-pause'];
        setSymbol(play.child, c.playing ? 'pause.fill' : 'play.fill', play._glyph, c.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        set('play-pause', c.player);
        set('previous', c.player && c.canPrev);
        set('next', c.player && c.canNext);
        // shuffle and repeat only when the player has them; on: full ink, off: dimmed
        set('shuffle', c.shuffle !== undefined, c.shuffle !== undefined);
        set('repeat', c.loop !== undefined, c.loop !== undefined);
        this._shuffleOn = Boolean(c.shuffle);
        this._loop = c.loop;
        if (c.shuffle !== undefined)
            this.controls.shuffle.opacity = c.shuffle ? 255 : 150;
        if (c.loop !== undefined) {
            const repeat = this.controls.repeat;
            repeat.opacity = c.loop === 'None' ? 150 : 255;
            // repeat.1 is not among the symbols: one track shows as repeat with a small "1"
            repeat.accessible_name = `repeat ${c.loop}`;
        }
        this._progress.reactive = Boolean(c.player && c.canSeek);
    }

    // fraction 0..1, or null: no output (the row dims)
    setVolume(fraction) {
        this._volumeRow.opacity = fraction === null ? Math.round(255 * DISABLED) : 255;
        this._volume.reactive = fraction !== null;
        this._setFill(this._volume, fraction ?? 0);
        this.volumeFraction = fraction;
    }

    // ---- the lyrics: the Music widget's LyricsView, larger, blurred by distance ----
    _buildLyrics(g) {
        const b = g.boxes.lyrics;
        const box = new St.Widget({name: 'tahoe-np-lyrics', reactive: false, layout_manager: new Clutter.BinLayout()});
        box.set_position(b.x, b.y);
        box.set_size(b.width, b.height);
        this._parent.add_child(box);
        this.parts.lyrics = box;
        this._lyricsX = b.x;
        this._lyrics = new LyricsView({
            labelStyle: `font-family: "SF Pro Display"; font-weight: 700; font-size: ${g.lyricSize}px; `,
            blur: Math.max(1, Math.round(LYRIC_BLUR * g.u)),
            anchor: (g.sungMiddle - b.y) / b.height,
        });
        box.add_child(this._lyrics.actor);
        this._lyrics.setLines(null, '');
        this.setInk(null);
    }

    // [[seconds, line]] or null
    setLyrics(lines) {
        this._lyrics.setLines(lines, '');
    }

    // seconds to the next line, or null
    updateLyrics(position) {
        return this._lyrics.update(position);
    }

    // ---- the chevron ----
    _buildChevron(g, onChevron) {
        const b = g.boxes.chevron;
        const chevron = new St.Button({
            style_class: 'tahoe-np-glass tahoe-np-chevron',
            accessible_name: 'Back to the desktop',
            can_focus: false,
            child: symbolActor('chevron.down', Math.round(26 * g.u), 'go-down-symbolic'),
        });
        chevron._tahoeNpControl = true;
        chevron.set_position(b.x, b.y);
        chevron.set_size(b.width, b.height);
        chevron.connect('clicked', () => this._guard(() => onChevron?.()));
        this._parent.add_child(chevron);
        this.chevron = chevron;
        this.parts.chevron = chevron;
    }

    // 1: two columns, 0: the column centred; moves only by translation and opacity
    setBlend(blend) {
        this._blend = blend;
        const g = geometry(this._monitor, blend);
        const g1 = geometry(this._monitor, 1);
        this._column.translation_x = g.boxes.cover.x - g1.boxes.cover.x;
        this.parts.lyrics.translation_x = g.boxes.lyrics.x - this._lyricsX;
        this.parts.lyrics.opacity = Math.round(255 * g.lyricsOpacity);
        this.parts.lyrics.visible = g.lyricsOpacity > 0;
        this.geometry = g;
    }

    get blend() {
        return this._blend;
    }

    // every part's box on the stage, as drawn (for the tests' layout checks)
    boxes() {
        const out = {};
        for (const [name, actor] of Object.entries(this.parts)) {
            if (!actor.visible || actor.opacity === 0 || name.startsWith('control-') || name === 'volume-track')
                continue;
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            out[name] = {x, y, width: w, height: h};
        }
        // the progress's row is the bar, not its taller hit area
        const [px, py] = this._progress._bar.get_transformed_position();
        const [pw, ph] = this._progress._bar.get_transformed_size();
        out.progress = {x: px, y: py, width: pw, height: ph};
        return out;
    }

    destroy() {
        if (this._wallClock) {
            this._wallClock.disconnect(this._wallClockId);
            this._wallClock.run_dispose();
            this._wallClock = null;
        }
        if (this._formatId)
            interfaceSettings.disconnect(this._formatId);
        this._formatId = 0;
        this._clock?.destroy();
        this._clock = null;
        this._inked = [];
    }
}
