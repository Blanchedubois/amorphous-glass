// What is playing, for the music widgets: the MPRIS player that is playing, else the first one
// found (as tahoe-control-center's mpris.js), plus the position, a local copy of web album art
// and synced lyrics. Everything is driven by D-Bus signals; the position is read once per track,
// play/pause or seek and counted on locally, never polled.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';   // the player itself: DesktopEntry, Identity, Raise
const CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'tahoe-widgets', 'art']);
const USER_AGENT = 'tahoe-widgets (https://github.com/Blanchedubois/amorphous-glass)';

let session = null;
function soup() {
    session ??= new Soup.Session({user_agent: USER_AGENT, timeout: 15});
    return session;
}

// the only network call (web covers, lyrics). While the screen is locked only a cover may be
// fetched, from the player's own cover URL (the user's choice, 2026-10-20: a song that starts while
// locked got no album colours for the swirl); lyrics never.
async function fetchBytes(url, {whileLocked = false} = {}) {
    if (Main.sessionMode.isLocked && !whileLocked)
        throw new Error('no network while the screen is locked');
    const message = Soup.Message.new('GET', url);
    const bytes = await new Promise((resolve, reject) => soup().send_and_read_async(
        message, GLib.PRIORITY_LOW, null, (s, res) => {
            try {
                resolve(s.send_and_read_finish(res));
            } catch (e) {
                reject(e);
            }
        }));
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()}`);
    return bytes;
}

const unpack = v => (v?.unpack ? v.unpack() : v);
const CACHE_ENTRIES = 64;   // art and lyrics remembered per session

// a Map that forgets its oldest entries past CACHE_ENTRIES
function remember(map, key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > CACHE_ENTRIES)
        map.delete(map.keys().next().value);
}

class Player {
    constructor() {
        this._listeners = new Set();
        this._proxies = new Map();
        this._position = {key: null, base: 0, at: 0, reading: false, again: false};
        this._calls = new Set();    // methods waiting for the player's answer
        this._art = new Map();      // web url -> local file uri, or a promise
        this._lyrics = new Map();   // track key -> [[seconds, line]] or null, or a promise
        this._watch = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE, (c, s, p, i, sig, params) => {
                const [name, , owner] = params.deep_unpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (owner)
                    this._add(name);
                else
                    this._remove(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deep_unpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch {}
            });
    }

    listen(fn) {
        this._listeners.add(fn);
    }

    unlisten(fn) {
        this._listeners.delete(fn);
    }

    _changed() {
        this._readPosition();
        this._listeners.forEach(fn => fn());
    }

    _add(name) {
        if (this._proxies.has(name))
            return;
        Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, null, name, PATH, IFACE, null, (o, res) => {
            try {
                const proxy = Gio.DBusProxy.new_finish(res);
                // closed, added twice, or the player left while the proxy was made
                if (!this._watch || this._proxies.has(name) || !proxy.g_name_owner)
                    return;
                proxy._ids = [
                    proxy.connect('g-properties-changed', () => this._changed()),
                    proxy.connect('g-signal', (_p, _sender, signal, params) => {
                        if (signal === 'Seeked' && proxy === this.current) {
                            this._setPosition(params.deep_unpack()[0]);
                            this._listeners.forEach(fn => fn());
                        }
                    }),
                ];
                this._proxies.set(name, proxy);
                this._readApp(proxy);
                this._changed();
            } catch {}
        });
    }

    _remove(name) {
        const proxy = this._proxies.get(name);
        if (!proxy)
            return;
        proxy._ids.forEach(id => proxy.disconnect(id));
        this._proxies.delete(name);
        this._changed();
    }

    // which app the player is, read once when it appears: {desktopEntry, identity, canRaise, pid}
    _readApp(proxy) {
        const app = proxy._app = {desktopEntry: '', identity: '', canRaise: false, pid: 0};
        const done = () => {
            if (this._watch && this._proxies.get(proxy.g_name) === proxy)
                this._listeners.forEach(fn => fn());
        };
        Gio.DBus.session.call(proxy.g_name, PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', [ROOT]), null, Gio.DBusCallFlags.NONE, 2000, null, (bus, res) => {
                try {
                    const [props] = bus.call_finish(res).recursiveUnpack();
                    app.desktopEntry = `${props.DesktopEntry ?? ''}`;
                    app.identity = `${props.Identity ?? ''}`;
                    app.canRaise = Boolean(props.CanRaise);
                } catch {}
                done();
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'GetConnectionUnixProcessID', new GLib.Variant('(s)', [proxy.g_name]), null,
            Gio.DBusCallFlags.NONE, 2000, null, (bus, res) => {
                try {
                    [app.pid] = bus.call_finish(res).deep_unpack();
                } catch {}
                done();
            });
    }

    // ask the current player to show itself (browsers switch to the playing tab); the caller
    // brings its window forward too, as Wayland may not let the player do that itself
    raise() {
        const proxy = this.current;
        if (!proxy?._app?.canRaise)
            return;
        Gio.DBus.session.call(proxy.g_name, PATH, ROOT, 'Raise', null, null,
            Gio.DBusCallFlags.NONE, 2000, null, (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch {}
            });
    }

    get current() {
        let best = null;
        for (const proxy of this._proxies.values()) {
            const status = proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status === 'Playing')
                return proxy;
            best ??= proxy;
        }
        return best;
    }

    // {key, title, artist, album, artUrl, url, length, playing, canPrev, canNext, app} or null;
    // app: {desktopEntry, identity, canRaise, pid} (filled in shortly after a player appears)
    get state() {
        const proxy = this.current;
        if (!proxy)
            return null;
        const md = proxy.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        const artist = unpack(md['xesam:artist']);
        const title = `${unpack(md['xesam:title']) ?? ''}`;
        const artistText = Array.isArray(artist) ? artist.join(', ') : `${artist ?? ''}`;
        const prop = n => proxy.get_cached_property(n)?.unpack();
        return {
            key: `${proxy.g_name}|${unpack(md['mpris:trackid']) ?? ''}|${title}|${artistText}`,
            title,
            artist: artistText,
            album: `${unpack(md['xesam:album']) ?? ''}`,
            artUrl: `${unpack(md['mpris:artUrl']) ?? ''}`,
            url: `${unpack(md['xesam:url']) ?? ''}`,
            length: Number(unpack(md['mpris:length']) ?? 0) / 1e6,
            playing: prop('PlaybackStatus') === 'Playing',
            canPrev: prop('CanGoPrevious') ?? true,
            canNext: prop('CanGoNext') ?? true,
            app: proxy._app ?? null,
        };
    }

    // ---- position, in seconds ----

    _setPosition(us) {
        this._position.base = Number(us) / 1e6;
        this._position.at = GLib.get_monotonic_time();
    }

    // one Get at a time; changes that come in meanwhile ask once more afterwards
    _readPosition() {
        const proxy = this.current;
        if (!proxy)
            return;
        const key = this.state.key;
        // keep counting until the answer comes; a new track starts at 0
        const now = this._position.key === key ? this.position(key) : 0;
        this._position.key = key;
        this._setPosition(now * 1e6);
        if (this._position.reading) {
            this._position.again = true;
            return;
        }
        this._position.reading = true;
        Gio.DBus.session.call(proxy.g_name, PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [IFACE, 'Position']), null, Gio.DBusCallFlags.NONE, 2000, null,
            (bus, res) => {
                this._position.reading = false;
                try {
                    const [value] = bus.call_finish(res).deep_unpack();
                    if (this._watch && this._position.key === key) {
                        this._setPosition(unpack(value));
                        this._listeners.forEach(fn => fn());
                    }
                } catch {}
                if (this._position.again && this._watch) {
                    this._position.again = false;
                    this._readPosition();
                }
            });
    }

    position(key = this.state?.key) {
        const p = this._position;
        if (!key || p.key !== key)
            return 0;
        const playing = this.state?.playing;
        return p.base + (playing ? (GLib.get_monotonic_time() - p.at) / 1e6 : 0);
    }

    // clicks that come while the player is still answering the same request are dropped,
    // so a spammed button never queues up calls
    call(method) {
        const proxy = this.current;
        const id = `${proxy?.g_name}|${method}`;
        if (!proxy || this._calls.has(id))
            return;
        this._calls.add(id);
        proxy.call(method, null, Gio.DBusCallFlags.NONE, 3000, null, (p, res) => {
            this._calls.delete(id);
            try {
                p.call_finish(res);
            } catch {}
        });
    }

    // ---- album art: a file uri St can draw ----

    // the art as a file uri St can draw; null while a web image downloads (the listeners hear
    // when it is ready) or when there is none
    art(url) {
        if (!url)
            return null;
        if (url.startsWith('file://'))
            return url;
        if (!/^https?:\/\//.test(url))
            return null;
        const known = this._art.get(url);
        if (typeof known === 'string')
            return known;
        if (known)
            return null;   // downloading
        const path = GLib.build_filenamev([CACHE, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1)]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            const uri = GLib.filename_to_uri(path, null);
            remember(this._art, url, uri);
            return uri;
        }
        remember(this._art, url, fetchBytes(url, {whileLocked: true}).then(bytes => {
            GLib.mkdir_with_parents(CACHE, 0o700);
            GLib.file_set_contents(path, bytes.get_data());
            remember(this._art, url, GLib.filename_to_uri(path, null));
            this._listeners.forEach(fn => fn());
        }, () => this._art.delete(url)));
        return null;
    }

    // ---- synced lyrics: a .lrc next to a local file, else lrclib.net ----

    // the lines or null if already known, else undefined (nothing is asked)
    knownLyrics(key) {
        const known = this._lyrics.get(key);
        return known instanceof Promise ? undefined : known;
    }

    // the lines, null if there are none, or undefined while they are looked up (onReady then)
    lyrics(state, onReady) {
        let known = this._lyrics.get(state.key);
        if (known !== undefined && !(known instanceof Promise))
            return known;
        if (!known) {
            known = findLyrics(state).catch(() => null).then(lines => {
                if (this._watch)
                    remember(this._lyrics, state.key, lines);
                return lines;
            });
            remember(this._lyrics, state.key, known);
        }
        known.then(lines => this._watch && onReady(lines));
        return undefined;
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._watch);
        this._watch = 0;
        for (const name of [...this._proxies.keys()])
            this._remove(name);
        this._listeners.clear();
    }
}

// "[01:02.50]line" -> [[62.5, 'line']], sorted; null if it has no timed lines
export function parseLrc(text) {
    const lines = [];
    for (const raw of text.split('\n')) {
        const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        if (!stamps.length)
            continue;
        const words = raw.replace(/\[[^\]]*\]/g, '').trim();
        for (const [, m, s] of stamps)
            lines.push([Number(m) * 60 + Number(s), words]);
    }
    lines.sort((a, b) => a[0] - b[0]);
    return lines.length ? lines : null;
}

async function findLyrics(state) {
    if (state.url.startsWith('file://')) {
        const path = GLib.filename_from_uri(state.url)[0].replace(/\.[^./]+$/, '.lrc');
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return parseLrc(new TextDecoder().decode(bytes));
        } catch {}
    }
    if (!state.title || !state.artist)
        return null;
    const query = [['track_name', state.title], ['artist_name', state.artist], ['album_name', state.album]]
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${GLib.uri_escape_string(v, null, true)}`);
    if (state.length > 0)
        query.push(`duration=${Math.round(state.length)}`);
    const bytes = await fetchBytes(`https://lrclib.net/api/get?${query.join('&')}`);
    const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    return json.syncedLyrics ? parseLrc(json.syncedLyrics) : null;
}

// one player for every music widget, closed with the last of them
let shared = null;
let users = 0;

export function acquirePlayer() {
    shared ??= new Player();
    users++;
    return shared;
}

export function releasePlayer() {
    if (--users > 0)
        return;
    shared.destroy();
    shared = null;
    session?.abort();
    session = null;
}
