// Music widgets: now playing in small, medium (wide), large, and large with synced lyrics.
// Layouts after the Tahoe Now Playing widget as ported in jaxparrow07/liquidglass-kde-widgets
// (GPL-3.0); no code or assets are taken from it. Data from MPRIS (mpris.js); lyrics from a
// .lrc next to a local file, else lrclib.net, fetched once per track and only for the lyrics widget.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {scaleFactor} from './glass.js';
import {acquirePlayer, releasePlayer} from './mpris.js';
import {Swirl} from './swirl.js';

const LYRIC_LINES = 7;
const LOOKUP_DELAY = 1000;   // ms a track has to stay before its lyrics are looked up

function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ellipsized(style, text = '') {
    const l = new St.Label({style_class: style, text});
    l.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
    return l;
}

// album art, rounded concentric with the card; a note on a soft tile when there is none
class Art {
    constructor(size) {
        this.actor = new St.Bin({
            style_class: 'tahoe-music-art',
            width: size * scaleFactor(), height: size * scaleFactor(),
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this._note = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(size * 0.4)});
        this._uri = undefined;
    }

    set(uri) {
        if (uri === this._uri)
            return;
        this._uri = uri;
        if (uri) {
            this.actor.set_child(null);
            this.actor.add_style_class_name('tahoe-music-art-image');
            this.actor.set_style(`background-image: url("${uri.replace(/"/g, '%22')}");`);
        } else {
            this.actor.remove_style_class_name('tahoe-music-art-image');
            this.actor.set_style(null);
            this.actor.set_child(this._note);
        }
    }
}

// a thin track with the elapsed part filled, the times under it
class Progress {
    constructor(withTimes) {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-music-progress',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._track = new St.Widget({
            style_class: 'tahoe-music-track',
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
        });
        this._fill = new St.Widget({style_class: 'tahoe-music-fill'});
        this._track.add_child(this._fill);
        this._track.connect('notify::width', () => this._place());
        this.actor.add_child(this._track);
        this._fraction = 0;
        if (withTimes) {
            const row = new St.BoxLayout({style_class: 'tahoe-music-times'});
            this._elapsed = new St.Label({style_class: 'tahoe-widget-secondary tahoe-music-time', x_expand: true});
            this._left = new St.Label({style_class: 'tahoe-widget-secondary tahoe-music-time'});
            row.add_child(this._elapsed);
            row.add_child(this._left);
            this.actor.add_child(row);
        }
    }

    _place() {
        if (!this._track.get_stage())   // placed again once allocated
            return;
        const h = this._track.height;
        this._fill.set_size(Math.round(this._fraction * this._track.width), h);
    }

    update(position, length) {
        this._fraction = length > 0 ? Math.min(1, position / length) : 0;
        this._place();
        if (this._elapsed) {
            this._elapsed.text = length > 0 ? clock(position) : '';
            this._left.text = length > 0 ? `-${clock(length - position)}` : '';
        }
    }
}

// previous, play/pause, next
class Transport {
    constructor(player, size, withSkip = true) {
        this.actor = new St.BoxLayout({style_class: 'tahoe-music-transport'});
        const button = (iconName, method) => {
            const b = new St.Button({
                style_class: 'tahoe-music-button',
                can_focus: false,
                child: new St.Icon({icon_name: iconName, icon_size: size}),
            });
            b.connect('clicked', () => player.call(method));
            this.actor.add_child(b);
            return b;
        };
        if (withSkip)
            this._prev = button('media-skip-backward-symbolic', 'Previous');
        this._play = button('media-playback-start-symbolic', 'PlayPause');
        if (withSkip)
            this._next = button('media-skip-forward-symbolic', 'Next');
    }

    update(state) {
        this._play.child.icon_name = state?.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.reactive = Boolean(state);
        if (this._prev) {
            this._prev.reactive = Boolean(state?.canPrev);
            this._prev.opacity = state?.canPrev ? 255 : 110;
            this._next.reactive = Boolean(state?.canNext);
            this._next.opacity = state?.canNext ? 255 : 110;
        }
    }
}

// the current line in full, the ones around it dimmed; moves on at each line's own time
class LyricsView {
    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-music-lyrics',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            clip_to_allocation: true,
        });
        this._labels = [];
        for (let i = 0; i < LYRIC_LINES; i++) {
            const l = new St.Label({style_class: 'tahoe-music-lyric'});
            l.clutter_text.line_wrap = true;
            this.actor.add_child(l);
            this._labels.push(l);
        }
        this._lines = null;
        this._shown = -2;
    }

    setLines(lines, message) {
        this._lines = lines;
        this._shown = -2;
        if (!lines)
            this._show([message], 0);
    }

    // the index of the line being sung at this position
    _index(position) {
        let i = -1;
        while (i + 1 < this._lines.length && this._lines[i + 1][0] <= position)
            i++;
        return i;
    }

    update(position) {
        if (!this._lines)
            return null;
        const index = this._index(position);
        if (index !== this._shown) {
            this._shown = index;
            const start = Math.max(0, index - 1);
            this._show(this._lines.slice(start, start + LYRIC_LINES).map(l => l[1] || '♪'), index - start);
        }
        // seconds until the next line
        const next = this._lines[index + 1];
        return next ? next[0] - position : null;
    }

    _show(texts, current) {
        this._labels.forEach((l, i) => {
            l.text = texts[i] ?? '';
            if (i === current)
                l.add_style_class_name('tahoe-music-lyric-current');
            else
                l.remove_style_class_name('tahoe-music-lyric-current');
        });
    }
}

class MusicWidget {
    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'tahoe-music',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._player = acquirePlayer();
        this._swirl = new Swirl();
        // the text follows the swirl's colours (light covers: dark text), not the glass mode
        this._swirl.onInk = dark => {
            this.actor.remove_style_class_name('tahoe-music-ink-dark');
            this.actor.remove_style_class_name('tahoe-music-ink-white');
            if (dark !== null)
                this.actor.add_style_class_name(dark ? 'tahoe-music-ink-dark' : 'tahoe-music-ink-white');
        };
        this._title = ellipsized('tahoe-music-title');
        this._artist = ellipsized('tahoe-widget-secondary tahoe-music-artist');
        this._build();
        this._onChange = () => this._refresh();
        this._player.listen(this._onChange);
        this._lyricTimer = 0;
        this._refresh();
    }

    // the album-colour swirl lives in the card's glass
    attachCard(card) {
        this._swirl.attachCard(card);
    }

    setMode(mode) {
        this._swirl.setMode(mode);
    }

    // the progress moves each second while playing
    get wantsSeconds() {
        return Boolean(this._progress && this._state?.playing);
    }

    tick() {
        this._swirl.check();   // a window may have moved over the card, or away
        if (this._state?.playing)
            this._progress?.update(this._player.position(), this._state.length);
    }

    _refresh() {
        if (!this._player)   // a late answer after destroy
            return;
        const wanted = this.wantsSeconds;
        const state = this._state = this._player.state;
        this._title.text = state?.title || 'Not Playing';
        this._artist.text = state ? state.artist : '';
        const art = state ? this._player.art(state.artUrl) : null;
        this._art?.set(art);
        // a web cover still downloading keeps the last colours until it is here
        if (art || !/^https?:/.test(state?.artUrl ?? ''))
            this._swirl.setCover(art);
        this._swirl.setPlaying(Boolean(state?.playing));
        this._transport?.update(state);
        this._progress?.update(state ? this._player.position() : 0, state?.length ?? 0);
        this._refreshLyrics(state);
        if (this.wantsSeconds !== wanted)
            this.requestTick?.();
    }

    _refreshLyrics() {}

    destroy() {
        if (this._lyricTimer)
            GLib.source_remove(this._lyricTimer);
        this._lyricTimer = 0;
        this._swirl.destroy();
        this._player.unlisten(this._onChange);
        this._player = null;
        releasePlayer();
        this.actor.destroy();
    }
}

// art and play/pause on top, the song at the bottom
export class MusicSmall extends MusicWidget {
    static size = 'small';

    _build() {
        const top = new St.BoxLayout({style_class: 'tahoe-music-row'});
        this._art = new Art(76);
        top.add_child(this._art.actor);
        top.add_child(new St.Widget({x_expand: true}));
        this._transport = new Transport(this._player, 20, false);
        this._transport.actor.y_align = Clutter.ActorAlign.START;
        top.add_child(this._transport.actor);
        this.actor.add_child(top);
        this.actor.add_child(new St.Widget({y_expand: true}));
        this.actor.add_child(this._title);
        this.actor.add_child(this._artist);
    }
}

// art at the left; the song and the controls beside it; the progress across the bottom
export class MusicMedium extends MusicWidget {
    static size = 'medium';

    _build() {
        const top = new St.BoxLayout({style_class: 'tahoe-music-row', y_expand: true});
        this._art = new Art(96);
        top.add_child(this._art.actor);
        const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        info.add_child(this._title);
        info.add_child(this._artist);
        info.add_child(new St.Widget({y_expand: true}));
        this._transport = new Transport(this._player, 20);
        this._transport.actor.x_align = Clutter.ActorAlign.START;
        info.add_child(this._transport.actor);
        top.add_child(info);
        this.actor.add_child(top);
        this._progress = new Progress(false);
        this.actor.add_child(this._progress.actor);
    }
}

// big art with the song beside it, the progress with times, the controls centred
export class MusicLarge extends MusicWidget {
    static size = 'large';

    _build() {
        const top = new St.BoxLayout({style_class: 'tahoe-music-row'});
        this._art = new Art(150);
        top.add_child(this._art.actor);
        this.actor.add_child(top);
        this.actor.add_child(new St.Widget({y_expand: true}));
        this._title.add_style_class_name('tahoe-music-title-large');
        this.actor.add_child(this._title);
        this.actor.add_child(this._artist);
        this._progress = new Progress(true);
        this.actor.add_child(this._progress.actor);
        this._transport = new Transport(this._player, 28);
        this._transport.actor.add_style_class_name('tahoe-music-transport-large');
        this._transport.actor.x_align = Clutter.ActorAlign.CENTER;
        this.actor.add_child(this._transport.actor);
    }
}

// small art and the song on top, the synced lyrics under it, then the progress
export class MusicLyrics extends MusicWidget {
    static size = 'large';

    _build() {
        const top = new St.BoxLayout({style_class: 'tahoe-music-row'});
        this._art = new Art(52);
        top.add_child(this._art.actor);
        const info = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        info.add_child(this._title);
        info.add_child(this._artist);
        top.add_child(info);
        this._transport = new Transport(this._player, 18, false);
        this._transport.actor.y_align = Clutter.ActorAlign.CENTER;
        top.add_child(this._transport.actor);
        this.actor.add_child(top);
        this._lyrics = new LyricsView();
        this.actor.add_child(this._lyrics.actor);
        this._progress = new Progress(false);
        this.actor.add_child(this._progress.actor);
    }

    // a new track is looked up once it has stayed for LOOKUP_DELAY ms, so skipping through
    // songs asks lrclib.net nothing; the answer is cached per track
    _refreshLyrics(state) {
        if (!state) {
            this._cancelLookup();
            this._lyricsKey = null;
            this._lyrics.setLines(null, '');
        } else if (state.key !== this._lyricsKey) {
            this._cancelLookup();
            this._lyricsKey = state.key;
            const known = this._player.knownLyrics(state.key);
            if (known !== undefined) {
                this._lyrics.setLines(known, 'No synced lyrics for this song');
            } else {
                this._lyrics.setLines(null, 'Looking for lyrics…');
                this._lookupId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LOOKUP_DELAY, () => {
                    this._lookupId = 0;
                    this._lookup(state);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
        this._followLyrics();
    }

    _lookup(state) {
        const key = state.key;
        const show = found => {
            if (this._player && this._lyricsKey === key) {
                this._lyrics.setLines(found, 'No synced lyrics for this song');
                this._followLyrics();
            }
        };
        const lines = this._player.lyrics(state, show);
        if (lines !== undefined)
            show(lines);
    }

    _cancelLookup() {
        if (this._lookupId)
            GLib.source_remove(this._lookupId);
        this._lookupId = 0;
    }

    destroy() {
        this._cancelLookup();
        super.destroy();
    }

    // one timer, to the next line only, and only while playing
    _followLyrics() {
        if (this._lyricTimer)
            GLib.source_remove(this._lyricTimer);
        this._lyricTimer = 0;
        if (!this._player)
            return;
        const wait = this._lyrics.update(this._player.position());
        if (wait === null || !this._state?.playing)
            return;
        this._lyricTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(50, Math.ceil(wait * 1000) + 20), () => {
            this._lyricTimer = 0;
            this._followLyrics();
            return GLib.SOURCE_REMOVE;
        });
    }
}
