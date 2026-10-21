// The login screen's stand-in for the Schedule widget's calendar feed (tahoe-widgets icsfeed.js):
// the same interface, but the events come from the user's locked session, not from the calendar's
// private link (the login screen runs as a system account: it cannot read the user's keyring or
// home folder, and never sees the link). Not a copy of the desktop's file (tools/gdm/shared.list).
//
// While the screen is locked, the lock screen (tahoe-lockscreen widgetstack.js) writes this week's
// events into /run/tahoe-nowplaying/schedule.json (the user's choice, 2026-10-20: today's events on
// the login screen too, readable by anyone at this machine), and removes it on unlock. They are
// shown only while that file is the writer's and its gnome-shell is still running (as the song,
// nowplaying.js); otherwise the widget says the calendar is locked.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

export const Status = {NONE: 'none', LOCKED: 'locked', LOADING: 'loading', OK: 'ok', OFFLINE: 'offline', INVALID: 'invalid'};

const DIR = GLib.getenv('TAHOE_NOWPLAYING_DIR') || '/run/tahoe-nowplaying';
const FILE = 'schedule.json';
const MAX_BYTES = 512 * 1024;
const MAX_EVENTS = 400;
const CHECK = 30;   // s: the writer still running
const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
const decoder = new TextDecoder();

// one event, as icsfeed.js gives it, with nothing else kept: {uid, title, allDay, start, end,
// startDate?, endDate?, color?}
function cleanEvent(e) {
    if (!e || typeof e !== 'object')
        return null;
    const text = (v, n) => typeof v === 'string' ? v.slice(0, n) : undefined;
    const num = v => Number.isFinite(v) ? v : undefined;
    const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    const out = {
        uid: text(e.uid, 200) ?? '',
        title: text(e.title, 200) ?? '',
        allDay: e.allDay === true,
        start: num(e.start) ?? 0,
        end: num(e.end) ?? 0,
    };
    if (date(e.startDate))
        out.startDate = e.startDate;
    if (date(e.endDate))
        out.endDate = e.endDate;
    if (typeof e.color === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., ]+\))$/.test(e.color))
        out.color = e.color;
    return out;
}

// the shared events, if the session that wrote them is still there: {events, updated} or null
function readShared() {
    const file = Gio.File.new_for_path(GLib.build_filenamev([DIR, FILE]));
    let info;
    try {
        info = file.query_info('standard::type,standard::size,unix::uid', NOFOLLOW, null);
    } catch {
        return null;
    }
    if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > MAX_BYTES)
        return null;
    const uid = info.get_attribute_uint32('unix::uid');
    const data = JSON.parse(decoder.decode(file.load_contents(null)[1]));
    if (!Number.isInteger(data?.pid) || data.pid <= 1 || !Array.isArray(data.events))
        return null;
    try {
        const proc = Gio.File.new_for_path(`/proc/${data.pid}`);
        if (proc.query_info('unix::uid', 0, null).get_attribute_uint32('unix::uid') !== uid)
            return null;
        if (decoder.decode(proc.get_child('comm').load_contents(null)[1]).trim() !== 'gnome-shell')
            return null;
    } catch {
        return null;
    }
    const events = data.events.slice(0, MAX_EVENTS).map(cleanEvent).filter(Boolean)
        .sort((a, b) => a.start - b.start);
    return {events, updated: Number.isFinite(data.updated) ? data.updated : 0};
}

class SharedFeed extends EventEmitter {
    constructor() {
        super();
        this._users = 0;
        this._events = [];
        this._updated = 0;
        this._status = Status.LOCKED;
        this._memo = new Map();
        this._monitor = null;
        this._checkId = 0;
        this.connect('events-changed', () => this._memo.clear());
    }

    get status() {
        return this._status;
    }

    get updated() {
        return this._updated;
    }

    get hasCopy() {
        return this._events.length > 0;
    }

    get cacheFile() {
        return null;
    }

    get events() {
        return this._events;
    }

    memo(key, compute) {
        if (!this._memo.has(key)) {
            if (this._memo.size > 16)
                this._memo.clear();
            this._memo.set(key, compute(this._events));
        }
        return this._memo.get(key);
    }

    // the window is the writer's (this week, either side)
    ensureWindow() {}

    _read() {
        let shared = null;
        try {
            shared = readShared();
        } catch {}
        const events = shared?.events ?? [];
        const status = shared ? Status.OK : Status.LOCKED;
        const changed = JSON.stringify(events) !== JSON.stringify(this._events);
        this._events = events;
        this._updated = shared?.updated ?? 0;
        if (changed)
            this.emit('events-changed');
        if (status !== this._status) {
            this._status = status;
            this.emit('status-changed');
        }
    }

    acquire() {
        if (this._users++ === 0) {
            try {
                this._monitor = Gio.File.new_for_path(DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
                this._monitor.set_rate_limit(500);
                this._monitor.connect('changed', () => this._read());
            } catch {
                this._monitor = null;
            }
            this._checkId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CHECK, () => {
                this._read();
                return GLib.SOURCE_CONTINUE;
            });
            this._read();
        }
        return this;
    }

    release() {
        if (--this._users > 0)
            return;
        this._monitor?.cancel();
        this._monitor = null;
        if (this._checkId)
            GLib.source_remove(this._checkId);
        this._checkId = 0;
    }
}

let feed = null;

export function acquireFeed() {
    feed ??= new SharedFeed();
    return feed.acquire();
}
