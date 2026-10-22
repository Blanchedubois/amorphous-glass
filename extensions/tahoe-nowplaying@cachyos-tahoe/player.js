// What plays, into the view (docs/NOWPLAYING_PLAN.md, Phase 3). The Music widget's MPRIS layer
// (shared/mpris.js: the playing player, else the first; art; lyrics from a .lrc or lrclib.net) and
// its colours (shared/palette.js); the system output's volume from GNOME's mixer. Everything runs
// only while the view is open and is released when it closes.
//
// Lyrics decide the layout: synced lyrics found, two columns; none (or only unsynced ones), the
// column centred. While a new track's lyrics are looked up the layout stays as it is, for at most
// HOLD_MS, so the column does not jump on every track change.

import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {acquirePlayer, releasePlayer} from './shared/mpris.js';
import {coverPalette, inkColour, swirlPalette} from './shared/palette.js';

const LOOKUP_DELAY = 1000;   // ms a track has to stay before its lyrics are looked up (the widget's)
const HOLD_MS = 2500;        // the layout waits this long for a new track's lyrics
const VOLUME_STEP = 0.05;
const SEEK_STEP = 10;        // s, Shift+arrows
const RESTART_AFTER = 3;     // s: previous restarts the track past this, as Apple Music
const DARK_INK_OVER = 0.62;  // the swirl's mean lightness over which the text turns dark

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export class PlayerController {
    // view: NowPlayingView; guard: the overlay's; onLayout(blend): the lyrics decided the layout
    constructor(view, {guard, onLayout}) {
        this._view = view;
        this._guard = guard;
        this._onLayout = onLayout;
        this._timers = new Set();
        this._player = acquirePlayer();
        this._onChange = () => this._guard(() => this._refresh());
        this._player.listen(this._onChange);
        this._lyricsKey = undefined;
        this._coverUri = undefined;
        this._serial = 0;
        this._watchVolume();
        this._refresh();
    }

    get state() {
        return this._player?.state ?? null;
    }

    // ---- timers, all removed on destroy ----
    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            this._guard(fn);
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
    }

    _cancel(id) {
        if (id && this._timers.delete(id))
            GLib.source_remove(id);
        return 0;
    }

    // ---- the state ----
    _refresh() {
        if (!this._player)
            return;
        const state = this._player.state;
        this._state = state;
        const v = this._view;
        v.setText(state?.title || 'Not Playing', state ? state.artist : '');
        v.setControls({
            player: Boolean(state), playing: Boolean(state?.playing),
            canPrev: Boolean(state?.canPrev), canNext: Boolean(state?.canNext), canSeek: Boolean(state?.canSeek),
            shuffle: state?.shuffle, loop: state?.loop,
        });
        this._refreshCover(state);
        this._tick();
        this._refreshLyrics(state);
    }

    // the cover, its colours (the swirl's palette) and the text's ink, read once per cover
    _refreshCover(state) {
        const art = state ? this._player.art(state.artUrl) : null;
        // a web cover still downloading keeps the last one until it is here
        if (!art && /^https?:/.test(state?.artUrl ?? ''))
            return;
        if (art === this._coverUri)
            return;
        this._coverUri = art;
        this._view.setCover(art);
        const mine = ++this._serial;
        if (!art) {
            this._view.setColours(null);
            this._view.setInk(null);
            return;
        }
        coverPalette(art).then(lab => this._guard(() => {
            if (mine !== this._serial || !this._player)
                return;
            if (!lab?.length) {
                this._view.setColours(null);
                this._view.setInk(null);
                return;
            }
            const palette = swirlPalette(lab);
            const dark = palette.reduce((s, c) => s + luma(c), 0) / palette.length > DARK_INK_OVER;
            this._view.setColours(palette);
            this._view.setInk(inkColour(lab, dark));
        })).catch(() => {});
    }

    // the progress, once a second while playing; the lyrics follow their own timer
    _tick() {
        this._tickId = this._cancel(this._tickId);
        const state = this._state;
        this._view.setProgress(state ? this._player.position() : 0, state?.length ?? 0);
        if (state?.playing)
            this._tickId = this._later(1000, () => this._tick());
    }

    // ---- lyrics ----
    _refreshLyrics(state) {
        const key = state?.key ?? null;
        const first = this._lyricsKey === undefined;
        if (key !== this._lyricsKey) {
            this._lyricsKey = key;
            this._lookupId = this._cancel(this._lookupId);
            this._holdId = this._cancel(this._holdId);
            if (!state) {
                this._setLines(null);
            } else {
                const known = this._player.knownLyrics(key);
                if (known !== undefined) {
                    this._setLines(known);
                } else {
                    // the layout stays while looking (HOLD_MS at most; centred at once when the
                    // view has just opened); the lines go at once
                    this._view.setLyrics(null);
                    this._lines = null;
                    if (first) {
                        this._onLayout?.(0);
                    } else {
                        this._holdId = this._later(HOLD_MS, () => {
                            this._holdId = 0;
                            if (this._lyricsKey === key)
                                this._onLayout?.(0);
                        });
                    }
                    this._lookupId = this._later(LOOKUP_DELAY, () => {
                        this._lookupId = 0;
                        const show = lines => this._guard(() => {
                            if (this._player && this._lyricsKey === key)
                                this._setLines(lines);
                        });
                        const lines = this._player.lyrics(state, show);
                        if (lines !== undefined)
                            show(lines);
                    });
                }
            }
        }
        this._follow();
    }

    _setLines(lines) {
        this._holdId = this._cancel(this._holdId);
        this._lines = lines;
        this._view.setLyrics(lines);
        this._onLayout?.(lines ? 1 : 0);
        this._follow();
    }

    get hasLyrics() {
        return Boolean(this._lines);
    }

    // one timer, to the next line only, and only while playing
    _follow() {
        this._followId = this._cancel(this._followId);
        if (!this._player || !this._lines)
            return;
        const wait = this._view.updateLyrics(this._player.position());
        if (wait === null || !this._state?.playing)
            return;
        this._followId = this._later(Math.max(50, Math.ceil(wait * 1000) + 20), () => this._follow());
    }

    // ---- the system volume (GNOME's mixer: the default output) ----
    _watchVolume() {
        this._mixer = Volume.getMixerControl();
        this._mixerIds = [
            this._mixer.connect('state-changed', () => this._guard(() => this._sinkChanged())),
            this._mixer.connect('default-sink-changed', () => this._guard(() => this._sinkChanged())),
        ];
        this._sinkChanged();
    }

    _sinkChanged() {
        if (this._sink && this._sinkIds)
            this._sinkIds.forEach(id => this._sink.disconnect(id));
        this._sinkIds = null;
        this._sink = this._mixer.get_state() === Gvc.MixerControlState.READY ? this._mixer.get_default_sink() : null;
        if (this._sink) {
            const update = () => this._guard(() => this._view.setVolume(this.volume));
            this._sinkIds = [this._sink.connect('notify::volume', update), this._sink.connect('notify::is-muted', update)];
        }
        this._view.setVolume(this.volume);
    }

    // 0..1 of GNOME's 100 %, or null without an output
    get volume() {
        if (!this._sink)
            return null;
        return this._sink.is_muted ? 0 : Math.min(1, this._sink.volume / this._mixer.get_vol_max_norm());
    }

    _setVolume(fraction) {
        if (!this._sink)
            return;
        const f = Math.min(1, Math.max(0, fraction));
        this._sink.volume = Math.round(f * this._mixer.get_vol_max_norm());
        this._sink.push_volume();
        if (this._sink.is_muted && f > 0)
            this._sink.change_is_muted(false);
    }

    // ---- the controls and the keys (keys.js actions) ----
    act(action, value) {
        const p = this._player;
        const state = this._state;
        if (!p)
            return;
        switch (action) {
        case 'play-pause':
            p.call('PlayPause');
            break;
        case 'pause':
            p.call('Pause');
            break;
        case 'stop':
            p.call('Stop');
            break;
        case 'next':
            p.call('Next');
            break;
        case 'previous':
            if (state?.canSeek && p.position() > RESTART_AFTER)
                p.setPosition(0);
            else
                p.call('Previous');
            break;
        case 'seek-forward':
            p.seek(SEEK_STEP);
            break;
        case 'seek-back':
            p.seek(-SEEK_STEP);
            break;
        case 'seek-to':
            if (state?.length > 0)
                p.setPosition(value * state.length);
            break;
        case 'shuffle':
            if (state?.shuffle !== undefined)
                p.setProperty('Shuffle', new GLib.Variant('b', !state.shuffle));
            break;
        case 'repeat': {
            const next = {None: 'Playlist', Playlist: 'Track', Track: 'None'}[state?.loop];
            if (next)
                p.setProperty('LoopStatus', new GLib.Variant('s', next));
            break;
        }
        case 'volume-up':
            this._setVolume((this.volume ?? 0) + VOLUME_STEP);
            break;
        case 'volume-down':
            this._setVolume((this.volume ?? 0) - VOLUME_STEP);
            break;
        case 'volume-to':
            this._setVolume(value);
            break;
        }
        this.lastAction = action;
    }

    destroy() {
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        if (this._sink && this._sinkIds)
            this._sinkIds.forEach(id => this._sink.disconnect(id));
        this._sinkIds = null;
        this._sink = null;
        if (this._mixer)
            this._mixerIds.forEach(id => this._mixer.disconnect(id));
        this._mixer = null;
        if (this._player) {
            this._player.unlisten(this._onChange);
            this._player = null;
            releasePlayer();
        }
    }
}
