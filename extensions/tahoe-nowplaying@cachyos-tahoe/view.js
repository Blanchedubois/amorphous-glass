// What the overlay shows (docs/NOWPLAYING_PLAN.md, Phase 2): the backdrop, the lock screen's glass
// clock, the player column, the lyrics and the chevron, placed by layout.js. Phase 2 fills the
// column and the lyrics with stand-ins (the mockups' original placeholder text, a plain cover);
// Phase 3 wires them to MPRIS, Phase 4 puts the swirl in the backdrop.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import {ClockPanes, clockMaterial, FONT as CLOCK_FONT} from './shared/clockpanes.js';
import {GlassPane} from './shared/paneglass.js';
import {geometry} from './layout.js';
import {symbolActor} from './symbols.js';

// the Music widget's lyrics motion constants (tahoe-widgets music.js): the lines not sung
const LINE_SCALE = 0.84;
const DIM = 125;

// original placeholder lines (never real lyrics in the repo); the sung one is SUNG
const PLACEHOLDER_LINES = ['the porch light burning low', 'so you could find the way back home',
    'the river hums a borrowed tune', 'and every window holds the moon', '(hold on, hold on)',
    'paper lanterns in the rain', 'we float them out and count to ten'];
const SUNG = 2;

const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

// 12 h without AM/PM, as on the lock screen; 24 h as GNOME is set
function timeText(now) {
    const h24 = interfaceSettings.get_string('clock-format') === '24h';
    return now.format(h24 ? '%H:%M' : '%l:%M').trim();
}

const dateText = now => now.format('%a %b %-d');

// the ink: white until Phase 3 takes it from the cover (palette.js inkColour)
const INK = [255, 255, 255];
const ink = (a = 1) => `rgba(${INK.join(', ')}, ${a})`;

export class NowPlayingView {
    // parent: the overlay actor (stage-sized); monitor: where the player goes; guard: the overlay's;
    // onControl: (name) => void for the controls; onChevron: () => void
    constructor(parent, monitor, {guard, onControl, onChevron}) {
        this._parent = parent;
        this._monitor = monitor;
        this._guard = guard;
        this._onControl = onControl;
        this._blend = 1;
        this.parts = {};

        // the backdrop: Phase 4's swirl over the blurred desktop; for now a still gradient in the
        // mockup's colours. The glass clones it.
        this.backdrop = new St.Widget({
            name: 'tahoe-np-backdrop',
            style_class: 'tahoe-np-backdrop',
            reactive: false,
        });
        this.backdrop.set_position(0, 0);
        this.backdrop.set_size(global.stage.width, global.stage.height);
        parent.add_child(this.backdrop);

        const g = geometry(monitor, 1);
        this._u = g.u;
        this._buildClock(g);
        this._buildColumn(g);
        this._buildLyrics(g);
        this._buildChevron(g, onChevron);
        this.setBlend(1);
    }

    // ---- the clock: the lock screen's (ClockPanes, B2 clear blur), the plain labels under it ----
    _buildClock(g) {
        const layer = new St.Widget({name: 'tahoe-np-clock', reactive: false, layout_manager: new Clutter.FixedLayout()});
        layer.set_position(0, 0);
        layer.set_size(global.stage.width, global.stage.height);
        this._parent.add_child(layer);
        this._clockLayer = layer;

        // the plain clock, shown only if the glass cannot be made
        const label = size => new St.Label({style: `font-family: "${CLOCK_FONT}"; font-size: ${size}px; color: ${ink(0.9)};`, opacity: 0});
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

        // the cover (a stand-in until Phase 3): the widget's empty art, at 12 px corners
        const cover = new St.Widget({
            style_class: 'tahoe-np-cover',
            style: `border-radius: ${g.coverRadius}px;`,
            layout_manager: new Clutter.BinLayout(),
        });
        cover.add_child(new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(b.cover.height * 0.3), style: `color: ${ink(0.6)};`, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        at(cover, b.cover, 'cover');

        const text = (string, css) => new St.Label({text: string, style: `text-align: center; ${css}`});
        const title = at(text('Paper Lanterns', `font-family: "SF Pro Display"; font-weight: 700; font-size: ${Math.round(42 * u)}px; color: ${ink()};`), b.title, 'title');
        title.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
        const artist = at(text('The Quiet Hours', `font-family: "SF Pro Display"; font-weight: 500; font-size: ${Math.round(34 * u)}px; color: ${ink(0.72)};`), b.artist, 'artist');
        artist.clutter_text.ellipsize = 3;

        // the widget's thin track: the ink at 0.22, the fill at 0.88
        const track = at(new St.Widget({style: `border-radius: ${b.progress.height / 2}px; background-color: ${ink(0.22)};`}), b.progress, 'progress');
        const fill = new St.Widget({style: `border-radius: ${b.progress.height / 2}px; background-color: ${ink(0.88)};`});
        fill.set_size(Math.round(b.progress.width * 0.34), b.progress.height);
        track.add_child(fill);

        const times = at(new St.Widget({layout_manager: new Clutter.BinLayout()}), b.times, 'times');
        const timeLabel = (string, align) => new St.Label({
            text: string, x_expand: true, x_align: align,
            style: `font-family: "SF Pro Text"; font-weight: 600; font-size: ${Math.round(21 * u)}px; color: ${ink(0.72)};`,
        });
        times.add_child(timeLabel('1:14', Clutter.ActorAlign.START));
        times.add_child(timeLabel('-2:21', Clutter.ActorAlign.END));

        // the transport: SF Symbols floating, centred; [symbol, glyph px, hit px, fallback icon, ink alpha]
        const transport = at(new St.Widget({layout_manager: new Clutter.FixedLayout()}), b.transport, 'transport');
        const items = [
            ['shuffle', 'shuffle', 32, 64, 'media-playlist-shuffle-symbolic', 0.72],
            ['previous', 'backward.fill', 52, 96, 'media-skip-backward-symbolic', 1],
            ['play-pause', 'pause.fill', 72, 112, 'media-playback-pause-symbolic', 1],
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
            button.set_size(size, size);
            button.set_position(Math.round(x), Math.round((b.transport.height - size) / 2));
            transport.add_child(button);
            x += size + gap;
        }

        // the volume: the system output's level on the same thin track, a speaker each end
        const volume = at(new St.Widget({layout_manager: new Clutter.FixedLayout()}), b.volume, 'volume');
        const end = Math.round(52 * u * k);   // wide enough for speaker.wave.3.fill
        const low = symbolActor('speaker.fill', Math.round(26 * u * k), 'audio-volume-low-symbolic');
        const high = symbolActor('speaker.wave.3.fill', Math.round(26 * u * k), 'audio-volume-high-symbolic');
        for (const [actor, left] of [[low, 0], [high, b.volume.width - end]]) {
            const box = new St.Bin({child: actor, style: `color: ${ink(0.72)};`, width: end, height: b.volume.height});
            box.set_position(left, 0);
            volume.add_child(box);
        }
        const vh = Math.max(4, Math.round(8 * u * k));
        const vtrack = new St.Widget({style: `border-radius: ${vh / 2}px; background-color: ${ink(0.22)};`});
        vtrack.set_position(end + Math.round(8 * u), Math.round((b.volume.height - vh) / 2));
        vtrack.set_size(b.volume.width - 2 * (end + Math.round(8 * u)), vh);
        vtrack._tahoeNpControl = true;
        vtrack.reactive = true;
        const vfill = new St.Widget({style: `border-radius: ${vh / 2}px; background-color: ${ink(0.88)};`});
        vfill.set_size(Math.round(vtrack.width * 0.62), vh);
        vtrack.add_child(vfill);
        volume.add_child(vtrack);
        track._tahoeNpControl = true;
        track.reactive = true;
    }

    // a floating control: the symbol, no plate; hover is the widget's soft circle (stylesheet)
    _control(name, child, alpha) {
        const button = new St.Button({
            style_class: 'tahoe-np-control',
            style: `color: ${ink(alpha)};`,
            can_focus: false,
            accessible_name: name,
            child,
        });
        button._tahoeNpControl = true;
        button.connect('clicked', () => this._guard(() => this._onControl?.(name)));
        this.parts[`control-${name}`] = button;
        return button;
    }

    // ---- the lyrics: the widget's styling, larger; stand-in lines until Phase 3 ----
    _buildLyrics(g) {
        const b = g.boxes.lyrics;
        const lyrics = new St.Widget({name: 'tahoe-np-lyrics', reactive: false, clip_to_allocation: true, layout_manager: new Clutter.FixedLayout()});
        lyrics.set_position(b.x, b.y);
        lyrics.set_size(b.width, b.height);
        this._parent.add_child(lyrics);
        this.parts.lyrics = lyrics;
        this._lyricsX = b.x;

        const labels = PLACEHOLDER_LINES.map((line, i) => {
            const l = new St.Label({
                text: line,
                style_class: 'tahoe-np-lyric',
                style: `font-size: ${g.lyricSize}px; color: ${ink()};`,
                pivot_point: new Graphene.Point({x: 0, y: 0.5}),
            });
            l.clutter_text.line_wrap = true;
            l.set_width(b.width);
            const away = Math.abs(i - SUNG);
            if (away) {
                l.set_scale(LINE_SCALE, LINE_SCALE);
                l.opacity = Math.round(DIM * Math.max(0, 1 - Math.max(0, away - 2) * 0.5));
            }
            lyrics.add_child(l);
            return l;
        });
        // the sung line's middle at sungMiddle; the rest above and below it, a third of a line apart
        const gap = Math.round(g.lyricSize * 0.42);
        const heights = labels.map(l => l.get_preferred_height(b.width)[1]);
        let y = g.sungMiddle - b.y - heights[SUNG] / 2;
        for (let i = SUNG - 1; i >= 0; i--)
            y -= heights[i] + gap;
        labels.forEach((l, i) => {
            l.set_position(0, Math.round(y));
            y += heights[i] + gap;
        });
        this._lyricLabels = labels;
    }

    // ---- the chevron ----
    _buildChevron(g, onChevron) {
        const b = g.boxes.chevron;
        const chevron = new St.Button({
            style_class: 'tahoe-np-chevron',
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
            if (!actor.visible || actor.opacity === 0)
                continue;
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            out[name] = {x, y, width: w, height: h};
        }
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
    }
}
