// The Schedule widgets' calendar feed: a private ICS link (Google Calendar's "Secret address in
// iCal format"), fetched with Soup 3 and kept in a private cache so the widgets work offline.
//
// The link is a password: anyone with it can read the calendar. It is read from the GNOME keyring
// or a 0600 file (scripts/tahoe-widgets.sh calendar-url writes either, and calendar-source says
// which), kept only in memory here, and never logged: messages name the host only.
//
// One feed for every Schedule widget, made once per shell session and kept across disable/enable
// (every screen lock) with its last state; its timers, monitors and requests run only while a
// widget holds it.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');
Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const CONF_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass']);
const SOURCE_FILE = GLib.build_filenamev([CONF_DIR, 'calendar-source']);   // store=keyring|file|none
const URL_FILE = GLib.build_filenamev([CONF_DIR, 'calendar-url']);
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'tahoe-glass']);
export const CACHE_ICS = GLib.build_filenamev([CACHE_DIR, 'calendar.ics']);
const CACHE_META = GLib.build_filenamev([CACHE_DIR, 'calendar.meta.json']);
// the occurrences ics-expand.js found, so a new shell shows them without parsing again
const CACHE_EVENTS = GLib.build_filenamev([CACHE_DIR, 'calendar.events.json']);
const HELPER = GLib.build_filenamev([GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), 'ics-expand.js']);

const SECRET_SCHEMA = 'org.cachyos.tahoe.Calendar';
const SECRET_ATTR = ['tahoe-glass', 'calendar-ics'];   // as tahoe-widgets.sh stores it

const REFRESH = 15 * 60;            // s between fetches
const JITTER = 60;                  // s, so many machines do not ask at the same second
const BACKOFF = [60, 120, 240, 480, 900];   // s after the 1st, 2nd, ... failure in a row
const MIN_GAP = 60;                 // s between attempts started by resume or the network
const TIMEOUT = 20;                 // s for the whole request
const MAX_BYTES = 16 * 1024 * 1024;
const CHUNK = 64 * 1024;
const HELPER_TIMEOUT = 30;          // s for ics-expand.js
// the days around today the helper expands: any week holding today, and tomorrow
const WINDOW_BEFORE = 7, WINDOW_AFTER = 9;     // the helper's [from, to)
const NEED_BEFORE = 6, NEED_AFTER = 8;         // re-run when today's need leaves it

// what the widgets show:
//   none     no link set
//   locked   the keyring is locked (it is never asked to unlock)
//   loading  a link, no copy yet
//   ok       the last fetch worked (or the server said nothing changed)
//   offline  the last fetch failed; retrying (the cache, if any, still shows)
//   invalid  the server refused the link (401, 403, 404, 410) or sent no calendar
export const Status = {NONE: 'none', LOCKED: 'locked', LOADING: 'loading', OK: 'ok', OFFLINE: 'offline', INVALID: 'invalid'};

const now = () => Math.floor(GLib.get_real_time() / 1e6);

function hostOf(url) {
    try {
        return GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host() ?? '?';
    } catch {
        return '?';
    }
}

// webcal:// is https://; plain http only for a local test server
function fetchUrl(url) {
    if (url.startsWith('webcal://'))
        return `https://${url.slice('webcal://'.length)}`;
    if (url.startsWith('https://'))
        return url;
    if (url.startsWith('http://') && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostOf(url)))
        return url;
    return null;
}

function localZoneId() {
    return GLib.TimeZone.new_local().get_identifier() || 'Local';
}

const linkId = url => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);

async function readText(path, cancellable) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

// a file only the user can read, replaced in one step; data: a Uint8Array or GLib.Bytes chunks
async function writePrivate(path, data, cancellable) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    const stream = await Gio.File.new_for_path(path).replace_async(null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, cancellable);
    try {
        // GLib.Bytes: the stream keeps its own reference while it writes (a JS array may move)
        for (const chunk of Array.isArray(data) ? data : [new GLib.Bytes(data)]) {
            for (let rest = chunk; rest.get_size() > 0;) {
                // eslint-disable-next-line no-await-in-loop
                const n = await stream.write_bytes_async(rest, GLib.PRIORITY_DEFAULT, cancellable);
                rest = n < rest.get_size() ? new GLib.Bytes(rest.toArray().subarray(n)) : new GLib.Bytes(new Uint8Array());
            }
        }
    } finally {
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

// the link from the keyring, without ever asking to unlock it: {url} or {locked: true} or {}
async function keyringLink() {
    const {default: Secret} = await import('gi://Secret');
    Gio._promisify(Secret.Service, 'get');
    Gio._promisify(Secret.Service.prototype, 'search');
    const schema = Secret.Schema.new(SECRET_SCHEMA, Secret.SchemaFlags.DONT_MATCH_NAME,
        {[SECRET_ATTR[0]]: Secret.SchemaAttributeType.STRING});
    try {
        const service = await Secret.Service.get(Secret.ServiceFlags.OPEN_SESSION, null);
        // LOAD_SECRETS without UNLOCK: secrets of unlocked items only, no prompt
        const items = await service.search(schema, {[SECRET_ATTR[0]]: SECRET_ATTR[1]},
            Secret.SearchFlags.LOAD_SECRETS, null);
        for (const item of items) {
            if (item.get_locked())
                return {locked: true};
            const url = item.get_secret()?.get_text()?.trim();
            if (url)
                return {url};
        }
        return {};
    } finally {
        // the service's proxy is not needed until the link changes
        Secret.Service.disconnect();
    }
}

class IcsFeed extends EventEmitter {
    constructor() {
        super();
        this._users = 0;
        this._url = null;
        this._linkRead = false;
        this._status = Status.NONE;
        this._meta = null;           // {link, etag, lastModified, fetched, changed}
        this._failures = 0;
        this._lastAttempt = 0;
        this._timerId = 0;
        this._sourceTimerId = 0;
        this._fetching = null;
        this._cancellable = null;
        this._session = null;
        this._events = [];
        this._window = null;         // {from, to, tz, changed} the events cover
        this._helper = null;
        this._expandAgain = false;
        this._memo = new Map();
        this.connect('events-changed', () => this._memo.clear());
    }

    // what the widgets read
    get status() {
        return this._status;
    }

    // unix time of the last good answer from the server (a new copy or "not modified"), or 0
    get updated() {
        return this._meta?.fetched ?? 0;
    }

    // a cached copy exists for the current link
    get hasCopy() {
        return Boolean(this._meta?.changed);
    }

    get cacheFile() {
        return CACHE_ICS;
    }

    // occurrences around today, sorted by start: {uid, title, allDay, start, end, startDate?,
    // endDate?, color?}, unix seconds; empty until the first copy is read
    get events() {
        return this._events;
    }

    // a value worked out once for every widget (today's events, this week's dots), until the
    // events change
    memo(key, compute) {
        if (!this._memo.has(key)) {
            if (this._memo.size > 16)
                this._memo.clear();
            this._memo.set(key, compute(this._events));
        }
        return this._memo.get(key);
    }

    // called on the widgets' minute tick (cheap): the events follow the day and the time zone
    ensureWindow(now) {
        // no link: nothing to show, even if an old copy is still on disk
        if (!this.hasCopy || !this._cancellable || this._status === Status.NONE)
            return;
        const day = n => now.add_days(n).format('%Y-%m-%d');
        const w = this._window;
        if (w && w.tz === localZoneId() && w.changed === this._meta.changed &&
            w.from <= day(-NEED_BEFORE) && w.to >= day(NEED_AFTER))
            return;
        this._expand(now);
    }

    // ics-expand.js over the cached copy, in its own process
    async _expand(now) {
        this._askedNow = now;
        if (this._helper) {
            this._expandAgain = true;
            return;
        }
        const from = now.add_days(-WINDOW_BEFORE).format('%Y-%m-%d');
        const to = now.add_days(WINDOW_AFTER).format('%Y-%m-%d');
        const tz = localZoneId();
        const changed = this._meta.changed;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
        if (tz !== 'Local')
            launcher.setenv('TZ', tz, true);
        let helper;
        try {
            helper = launcher.spawnv(['gjs', '-m', HELPER, CACHE_ICS, '--from', from, '--to', to]);
        } catch (e) {
            console.warn(`tahoe-widgets: calendar: cannot start the reader: ${e.message}`);
            return;
        }
        this._helper = helper;
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, HELPER_TIMEOUT, () => {
            helper.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        let out = null, err = '';
        try {
            [out, err] = await helper.communicate_utf8_async(null, null);
        } catch {}
        GLib.source_remove(timeoutId);
        if (this._helper !== helper)   // stopped meanwhile
            return;
        this._helper = null;
        if (helper.get_successful() && out) {
            try {
                const data = JSON.parse(out);
                this._events = data.events;
                this._window = {from, to, tz, changed};
                this.emit('events-changed');
                writePrivate(CACHE_EVENTS, new TextEncoder().encode(JSON.stringify({...this._window, events: data.events})),
                    this._cancellable).catch(() => {});
            } catch (e) {
                console.warn(`tahoe-widgets: calendar: the reader's answer: ${e.message}`);
            }
        } else if (helper.get_if_exited() && helper.get_exit_status() === 2) {
            this._window = {from, to, tz, changed};   // same copy: no point reading it again
            this._setStatus(Status.INVALID, (err ?? '').trim().split('\n').pop().replace(/^ics-expand: /, ''));
        } else {
            console.warn('tahoe-widgets: calendar: the reader stopped or took too long');
            this._window = {from, to, tz, changed};
        }
        if (this._expandAgain) {
            this._expandAgain = false;
            this.ensureWindow(this._askedNow);
        }
    }

    // a new copy, or no link any more
    _dataChanged() {
        if (!this._url && this._status === Status.NONE && this._events.length) {
            this._events = [];
            this._window = null;
            this.emit('events-changed');
        }
        this.ensureWindow(GLib.DateTime.new_now_local());
        this.emit('data-changed');
    }

    acquire() {
        if (this._users++ === 0)
            this._start();
        return this;
    }

    release() {
        if (--this._users === 0)
            this._stop();
    }

    _setStatus(status, why = '') {
        if (status === this._status)
            return;
        if ([Status.OFFLINE, Status.INVALID, Status.LOCKED].includes(status))
            console.warn(`tahoe-widgets: calendar (${this._url ? hostOf(this._url) : 'no link'}): ${status}${why ? `, ${why}` : ''}`);
        this._status = status;
        this.emit('status-changed');
    }

    _start() {
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: TIMEOUT, idle_timeout: 30,
            user_agent: 'tahoe-widgets (GNOME Shell) ', max_conns_per_host: 1});

        this._sourceMonitor = Gio.File.new_for_path(SOURCE_FILE).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._sourceMonitor.connect('changed', (m, f, o, event) => {
            if (event !== Gio.FileMonitorEvent.ATTRIBUTE_CHANGED)
                this._sourceChanged();
        });
        Gio.NetworkMonitor.get_default().connectObject('network-changed', (m, available) => {
            if (available && (this._status === Status.OFFLINE || this._stale()))
                this._soon(2);
        }, this);
        LoginManager.getLoginManager().connectObject('prepare-for-sleep', (lm, aboutToSuspend) => {
            if (!aboutToSuspend)
                this._soon(5);   // the network often comes back a little later; it asks again then
        }, this);

        this._init().catch(e => console.warn(`tahoe-widgets: calendar start: ${e.message}`));
    }

    _stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._clearTimer();
        if (this._sourceTimerId)
            GLib.source_remove(this._sourceTimerId);
        this._sourceTimerId = 0;
        this._sourceMonitor?.cancel();
        this._sourceMonitor = null;
        Gio.NetworkMonitor.get_default().disconnectObject(this);
        LoginManager.getLoginManager().disconnectObject(this);
        this._session?.abort();
        this._session = null;
        this._fetching = null;
        this._helper?.force_exit();
        this._helper = null;
        this._expandAgain = false;
    }

    async _init() {
        const cancellable = this._cancellable;
        if (!this._meta) {
            try {
                this._meta = JSON.parse(await readText(CACHE_META, cancellable) ?? 'null');
            } catch {
                this._meta = null;
            }
            // the events from the last shell, if they are of this copy (a new link clears the cache)
            try {
                const cached = JSON.parse(await readText(CACHE_EVENTS, cancellable) ?? 'null');
                if (cached && this._meta?.changed && cached.changed === this._meta.changed) {
                    this._events = cached.events;
                    this._window = {from: cached.from, to: cached.to, tz: cached.tz, changed: cached.changed};
                    this.emit('events-changed');
                }
            } catch {}
        }
        if (!this._linkRead || this._status === Status.LOCKED)
            await this._readLink();
        if (cancellable.is_cancelled())
            return;
        if (this._url)
            this._stale() ? this._soon(0) : this._schedule(this._meta.fetched + REFRESH - now());
    }

    async _readLink() {
        this._linkRead = true;
        const source = await readText(SOURCE_FILE, this._cancellable);
        const store = source?.match(/^store=(\w+)/m)?.[1] ?? (GLib.file_test(URL_FILE, GLib.FileTest.EXISTS) ? 'file' : 'none');
        let url = null;
        let locked = false;
        if (store === 'keyring') {
            try {
                ({url = null, locked = false} = await keyringLink());
            } catch (e) {
                console.warn(`tahoe-widgets: calendar: keyring: ${e.message}`);
            }
        } else if (store === 'file') {
            url = (await readText(URL_FILE, this._cancellable))?.split('\n')[0].trim() || null;
        }
        this._url = url;
        const other = url && this._meta?.link !== linkId(url);
        if (other) {
            this._meta = {link: linkId(url)};   // another calendar: its cache is not this one's
            this._events = [];
            this._window = null;
            this.emit('events-changed');
        }
        if (locked)
            this._setStatus(Status.LOCKED);
        else if (!url)
            this._setStatus(Status.NONE);
        else if (other || [Status.NONE, Status.LOCKED, Status.INVALID].includes(this._status))
            this._setStatus(this.hasCopy ? Status.OK : Status.LOADING);
        this._dataChanged();
        if (locked)
            this._retry();
    }

    // tahoe-widgets.sh calendar-url wrote a new link (it renames over the file: several events)
    _sourceChanged() {
        if (this._sourceTimerId)
            GLib.source_remove(this._sourceTimerId);
        this._sourceTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._sourceTimerId = 0;
            this._failures = 0;
            this._lastAttempt = 0;
            this._readLink().then(() => {
                if (this._url && this._cancellable)
                    this._soon(0);
                else
                    this._clearTimer();
            }).catch(e => console.warn(`tahoe-widgets: calendar link: ${e.message}`));
            return GLib.SOURCE_REMOVE;
        });
    }

    _stale() {
        return !this._meta?.fetched || now() - this._meta.fetched >= REFRESH;
    }

    _clearTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
    }

    _schedule(seconds) {
        this._clearTimer();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(seconds)), () => {
            this._timerId = 0;
            this._attempt();
            return GLib.SOURCE_REMOVE;
        });
    }

    // soon, but at most once a minute
    _soon(delay) {
        if (!this._cancellable || this._fetching)
            return;
        this._schedule(Math.max(delay, this._lastAttempt + MIN_GAP - now()));
    }

    _retry() {
        this._schedule(BACKOFF[Math.min(this._failures, BACKOFF.length - 1)]);
        this._failures++;
    }

    _attempt() {
        if (this._status === Status.LOCKED) {
            this._readLink().then(() => this._url && this._attempt()).catch(() => {});
            return;
        }
        if (!this._url || this._fetching || !this._cancellable)
            return;
        // the desktop widgets are off while locked; this is in case one is not
        if (Main.sessionMode.isLocked) {
            this._schedule(REFRESH);
            return;
        }
        this._lastAttempt = now();
        const cancellable = this._cancellable;
        this._fetching = this._fetch(cancellable).catch(e => {
            if (!cancellable.is_cancelled())
                console.warn(`tahoe-widgets: calendar cache: ${e.message}`);
        }).finally(() => {
            this._fetching = null;
        });
    }

    async _fetch(cancellable) {
        const url = fetchUrl(this._url);
        const message = url ? Soup.Message.new('GET', url) : null;
        if (!message) {
            this._setStatus(Status.INVALID, 'not an https address');
            return;
        }
        const headers = message.get_request_headers();
        headers.append('Accept', 'text/calendar, */*;q=0.5');
        if (this.hasCopy && this._meta.etag)
            headers.append('If-None-Match', this._meta.etag);
        if (this.hasCopy && this._meta.lastModified)
            headers.append('If-Modified-Since', this._meta.lastModified);

        // the whole request within TIMEOUT (Soup's own timeout is per read, so a slow drip
        // could go on for ever); stopped too when the feed stops
        const request = new Gio.Cancellable();
        const stopId = cancellable.connect(() => request.cancel());   // g_cancellable_connect
        let timedOut = false;
        let deadlineId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TIMEOUT, () => {
            deadlineId = 0;
            timedOut = true;
            request.cancel();
            return GLib.SOURCE_REMOVE;
        });
        let body = null;
        try {
            const stream = await this._session.send_async(message, GLib.PRIORITY_DEFAULT, request);
            if (message.status_code === Soup.Status.OK)
                body = await readAll(stream, request);
            await stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        } catch (e) {
            if (cancellable.is_cancelled())
                return;
            this._session.abort();   // drop the connection: it may be half read
            const why = timedOut ? 'timed out' : e instanceof GLib.Error ? `${e.domain === Gio.io_error_quark() ? 'io' : 'error'} ${e.code}` : e.message;
            this._setStatus(Status.OFFLINE, why);
            this._retry();
            return;
        } finally {
            if (deadlineId)
                GLib.source_remove(deadlineId);
            cancellable.disconnect(stopId);
        }
        if (cancellable.is_cancelled())
            return;

        // the plain number: get_status() throws on codes Soup has no name for (429)
        const code = message.status_code;
        const response = message.get_response_headers();
        if (code === Soup.Status.OK) {
            if (!looksLikeCalendar(body)) {
                this._setStatus(Status.INVALID, 'the answer is not a calendar');
                return;
            }
            const meta = {link: linkId(this._url), etag: response.get_one('ETag'),
                lastModified: response.get_one('Last-Modified'), fetched: now(), changed: now()};
            await writePrivate(CACHE_ICS, body, cancellable);
            await this._saveMeta(meta, cancellable);
            this._failures = 0;
            this._setStatus(Status.OK);
            this._dataChanged();
        } else if (code === Soup.Status.NOT_MODIFIED && this.hasCopy) {
            await this._saveMeta({...this._meta, fetched: now()}, cancellable);
            this._failures = 0;
            this._setStatus(Status.OK);
            this.emit('status-changed');   // the "updated" time moved
        } else if ([401, 403, 404, 410].includes(code)) {
            // the link is wrong or was reset in Google Calendar: no retries until it changes
            this._setStatus(Status.INVALID, `HTTP ${code}`);
            return;
        } else {
            this._setStatus(Status.OFFLINE, `HTTP ${code}`);
            const after = Number(response.get_one('Retry-After'));
            this._retry();
            if (after > 0)
                this._schedule(Math.min(Math.max(after, BACKOFF[0]), 3600));
            return;
        }
        this._schedule(REFRESH + GLib.random_int_range(0, JITTER));
    }

    async _saveMeta(meta, cancellable) {
        this._meta = meta;
        await writePrivate(CACHE_META, new TextEncoder().encode(JSON.stringify(meta)), cancellable);
    }
}

// the body as the chunks it came in (GLib.Bytes): a 5 MB feed is never copied in JS
async function readAll(stream, cancellable) {
    const chunks = [];
    let size = 0;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const bytes = await stream.read_bytes_async(CHUNK, GLib.PRIORITY_DEFAULT, cancellable);
        const n = bytes.get_size();
        if (n === 0)
            break;
        size += n;
        if (size > MAX_BYTES)
            throw new Error(`over ${MAX_BYTES >> 20} MB`);
        chunks.push(bytes);
    }
    return chunks;
}

// a calendar, not a sign-in page sent with 200
function looksLikeCalendar(chunks) {
    const first = chunks[0]?.toArray().subarray(0, 64) ?? new Uint8Array();
    const head = new TextDecoder().decode(first).replace(/^\ufeff/, '').trimStart();
    return head.toUpperCase().startsWith('BEGIN:VCALENDAR');
}

let feed = null;

export function acquireFeed() {
    feed ??= new IcsFeed();
    return feed.acquire();
}
