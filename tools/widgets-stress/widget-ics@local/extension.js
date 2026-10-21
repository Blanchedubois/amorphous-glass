// Headless only (never installed): the Schedule widgets' calendar feed (icsfeed.js) against
// ics-server.py on 127.0.0.1. Link from a file and from a throwaway keyring made inside the test
// session, fetch, private cache, 304, errors, backoff, network and resume triggers, invalid links,
// a locked keyring (never asked to unlock), release and re-acquire. Results in $SHOT_OUT/ics.jsonl.
// The test link carries the marker TESTSECRET0042; ics-feed-test.sh checks it is in no log.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('SHOT_OUT');
const HARNESS = GLib.getenv('STRESS_HARNESS');
const UUID = 'tahoe-widgets@cachyos-tahoe';
const CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass']);
const CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'tahoe-glass']);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function write(obj) {
    const st = Gio.File.new_for_path(`${OUT}/ics.jsonl`).append_to(Gio.FileCreateFlags.NONE, null);
    st.write_all(new TextEncoder().encode(`${JSON.stringify(obj)}\n`), null);
    st.close(null);
}
let failed = 0;
function check(name, ok, detail = {}) {
    if (!ok)
        failed++;
    write({check: name, ok: Boolean(ok), ...detail});
}

async function waitFor(fn, ms) {
    const end = GLib.get_monotonic_time() + ms * 1000;
    while (GLib.get_monotonic_time() < end) {
        if (fn())
            return true;
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
    }
    return Boolean(fn());
}

const perms = path => {
    try {
        return (Gio.File.new_for_path(path).query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode') & 0o777).toString(8);
    } catch {
        return null;
    }
};

function writeFile(path, text, private_ = true) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    GLib.file_set_contents_full(path, text, GLib.FileSetContentsFlags.CONSISTENT, private_ ? 0o600 : 0o644);
}
let changes = 0;
const setSource = store => writeFile(`${CONF}/calendar-source`, `store=${store}\nchanged=${++changes}\n`);

async function run(argv, input = null) {
    const p = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [out, err] = await p.communicate_utf8_async(input, null);
    return {ok: p.get_successful(), out, err};
}

export default class IcsTest extends Extension {
    enable() {
        if (this._started)
            return;
        this._started = true;
        this._run().catch(e => write({error: `${e}`, stack: e.stack}))
            .finally(() => {
                this._server?.force_exit();
                write({done: true, failed});
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; });
            });
    }

    async _run() {
        await sleep(3000);
        Main.overview.hide();
        const portFile = `${GLib.get_tmp_dir()}/ics-port-${GLib.random_int()}`;
        this._server = Gio.Subprocess.new(['python3', '-I', `${HARNESS}/ics-server.py`, portFile], Gio.SubprocessFlags.NONE);
        await waitFor(() => GLib.file_test(portFile, GLib.FileTest.EXISTS), 5000);
        const port = new TextDecoder().decode(GLib.file_get_contents(portFile)[1]).trim();
        GLib.unlink(portFile);
        const base = `http://127.0.0.1:${port}`;
        const session = new Soup.Session();
        const get = async path => new TextDecoder().decode((await session.send_and_read_async(
            Soup.Message.new('GET', `${base}${path}`), GLib.PRIORITY_DEFAULT, null)).toArray());
        const serve = m => get(`/_mode?m=${m}`);
        const log = async () => JSON.parse(await get('/_log'));
        const link = `${base}/private-TESTSECRET0042/basic.ics`;

        const ext = Main.extensionManager.lookup(UUID);
        const {acquireFeed, Status} = await import(`file://${ext.path}/icsfeed.js`);
        const feed = acquireFeed();
        let data = 0;
        feed.connect('data-changed', () => data++);
        const again = () => {   // the next fetch now, past the once-a-minute guard
            feed._lastAttempt = 0;
            feed._soon(0);
        };

        if (GLib.getenv('ICS_ONLY') === 'keyring')
            return this._keyring(feed, link, log, Status);
        await sleep(1500);
        check('no link: status none, no request', feed.status === Status.NONE && (await log()).length === 0, {status: feed.status});

        writeFile(`${CONF}/calendar-url`, `${link}\n`);
        setSource('file');
        await waitFor(() => feed.status === Status.OK, 8000);
        let l = await log();
        check('link from the file: fetched, ok', feed.status === Status.OK && l.length === 1 && !l[0].inm, {status: feed.status, log: l.length});
        check('cache is private', perms(`${CACHE}/calendar.ics`) === '600' && perms(`${CACHE}/calendar.meta.json`) === '600' && perms(CACHE) === '700',
            {ics: perms(`${CACHE}/calendar.ics`), meta: perms(`${CACHE}/calendar.meta.json`), dir: perms(CACHE)});
        const meta = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${CACHE}/calendar.meta.json`)[1]));
        check('meta keeps the validators, not the link', meta.etag && meta.lastModified && !JSON.stringify(meta).includes('TESTSECRET'), {keys: Object.keys(meta)});
        check('user agent', /tahoe-widgets/.test(l[0]?.ua ?? ''), {ua: l[0]?.ua});
        check('next refresh scheduled', feed._timerId !== 0);

        // the reader (ics-expand.js, its own process): basic.ics is one event a day at 15:00 UTC
        await waitFor(() => feed.events.length > 0, 10000);
        const today = GLib.DateTime.new_now_local();
        const inWindow = feed.events.filter(e => e.title === 'Daily fixture event');
        check('reader: the days around today, one occurrence each', inWindow.length === 16 &&
            feed._window.from === today.add_days(-7).format('%Y-%m-%d') && feed._window.to === today.add_days(9).format('%Y-%m-%d'),
        {count: feed.events.length, window: feed._window});
        check('reader: events cache is private', perms(`${CACHE}/calendar.events.json`) === '600');
        const helperRuns = () => feed._window;
        const w0 = helperRuns();
        feed.ensureWindow(today);
        feed.ensureWindow(today.add_days(1));
        check('reader: not run again for the same copy and day, nor the next day', feed._helper === null && feed._window === w0);
        feed.ensureWindow(today.add_days(3));
        check('reader: run again when the days run out', feed._helper !== null);
        await waitFor(() => feed._helper === null, 10000);
        feed.ensureWindow(today);
        await waitFor(() => feed._helper === null, 10000);

        // a new shell: the events come from the cache, before any fetch or reader run
        const fresh = new feed.constructor();
        fresh.acquire();
        await waitFor(() => fresh.events.length > 0, 3000);
        check('new shell: cached events shown at once, no reader run', fresh.events.length === 16 && fresh._helper === null,
            {count: fresh.events.length});
        fresh.release();
        await log();

        await sleep(1100);
        const before = feed.updated;
        const dataBefore = data;
        again();
        await waitFor(() => feed.updated > before, 5000);
        l = await log();
        check('304: If-None-Match and If-Modified-Since sent, cache kept, updated moved',
            l.length === 1 && l[0].inm && l[0].ims && feed.updated > before && data === dataBefore && feed.status === Status.OK, {log: l});

        await serve('500');
        again();
        await waitFor(() => feed.status === Status.OFFLINE, 5000);
        check('500: offline, retry scheduled', feed.status === Status.OFFLINE && feed._failures === 1 && feed._timerId !== 0, {failures: feed._failures});
        check('offline keeps the copy', feed.hasCopy && GLib.file_test(`${CACHE}/calendar.ics`, GLib.FileTest.EXISTS));
        again();
        await waitFor(() => feed._failures === 2, 5000);
        check('backoff grows', feed._failures === 2);

        await serve('ok');
        feed._lastAttempt = 0;
        Gio.NetworkMonitor.get_default().emit('network-changed', true);
        await waitFor(() => feed.status === Status.OK, 8000);
        check('network back: fetched again, ok, backoff reset', feed.status === Status.OK && feed._failures === 0);
        await log();

        feed._lastAttempt = 0;
        LoginManager.getLoginManager().emit('prepare-for-sleep', false);
        await waitFor(() => false, 6500);
        l = await log();
        check('resume from suspend: fetched', l.length === 1, {log: l.length});
        LoginManager.getLoginManager().emit('prepare-for-sleep', false);
        Gio.NetworkMonitor.get_default().emit('network-changed', true);
        await sleep(6500);
        l = await log();
        check('at most once a minute', l.length === 0 && feed._timerId !== 0, {log: l.length});

        await serve('429');
        again();
        await waitFor(() => feed.status === Status.OFFLINE, 5000);
        check('429: offline, retry later', feed.status === Status.OFFLINE && feed._timerId !== 0);

        await serve('drop');
        again();
        await sleep(2500);
        check('dropped connection: offline', feed.status === Status.OFFLINE);

        await serve('html');
        again();
        await waitFor(() => feed.status === Status.INVALID, 5000);
        check('a sign-in page with 200: invalid, no retry, copy kept', feed.status === Status.INVALID && feed._timerId === 0 && feed.hasCopy);

        await log();
        await serve('404');
        setSource('file');   // the link "changed" (same link): tries again
        await sleep(3000);
        l = await log();
        check('404: invalid, no retry', feed.status === Status.INVALID && feed._timerId === 0 && l.length === 1, {status: feed.status, log: l.length});

        await serve('big');
        setSource('file');
        await waitFor(() => feed.status === Status.OFFLINE, 8000);
        check('over 16 MB: refused, offline', feed.status === Status.OFFLINE);

        await serve('slow');
        again();
        await waitFor(() => feed._fetching !== null, 3000);
        const t0 = GLib.get_monotonic_time();
        await waitFor(() => feed._fetching === null, 30000);
        const took = (GLib.get_monotonic_time() - t0) / 1e6;
        check('slow server: gives up after the 20 s timeout', feed.status === Status.OFFLINE && took > 18 && took < 26, {took});

        // a calendar the reader cannot read
        await serve('ok');
        writeFile(`${CONF}/calendar-url`, `${base}/private-TESTSECRET0042/truncated.ics\n`);
        setSource('file');
        await waitFor(() => feed.status === Status.INVALID, 10000);
        check('a feed the reader cannot read: invalid, no events of another calendar', feed.status === Status.INVALID && feed.events.length === 0,
            {status: feed.status, events: feed.events.length});

        await log();
        writeFile(`${CONF}/calendar-url`, `${base}/private-TESTSECRET0099/basic.ics\n`);
        const statuses = [];
        const id = feed.connect('status-changed', () => statuses.push(feed.status));
        setSource('file');
        await waitFor(() => feed.status === Status.OK, 8000);
        feed.disconnect(id);
        l = await log();
        check('another link: old validators dropped, loading then ok', l.length === 1 && !l[0].inm && statuses[0] === Status.LOADING && feed.status === Status.OK,
            {statuses, log: l});

        feed.release();
        check('released: no timer, no monitor', feed._timerId === 0 && feed._sourceMonitor === null && feed._cancellable === null);
        acquireFeed();
        await sleep(2500);
        l = await log();
        check('acquired again within 15 min: no fetch, timer back', l.length === 0 && feed._timerId !== 0 && feed.status === Status.OK);

        await this._keyring(feed, link, log, Status);
    }

    async _keyring(feed, link, log, Status) {
        let l;
        // the keyring: the throwaway one run.sh starts (TEST_KEYRING=1) in this session's own D-Bus and data folder
        const stored = await run(['timeout', '10', 'secret-tool', 'store', '--label=test', 'tahoe-glass', 'calendar-ics'], link);
        check('throwaway keyring stores the link', stored.ok, {err: stored.err.slice(0, 120)});
        GLib.unlink(`${CONF}/calendar-url`);
        await log();
        setSource('keyring');
        await sleep(3000);
        l = await log();
        check('link from the keyring: ok', feed.status === Status.OK && l.length === 1, {status: feed.status, log: l.length,
            timer: feed._timerId, fetching: Boolean(feed._fetching), last: feed._lastAttempt, url: feed._url ? feed._url.length : null, http: feed._url?.startsWith('http://127.0.0.1')});

        const locked = await run(['timeout', '10', 'secret-tool', 'lock', '--collection=/org/freedesktop/secrets/collection/login']);
        write({info: 'locked the test keyring', ok: locked.ok, err: locked.err.slice(0, 120)});
        setSource('keyring');
        await waitFor(() => feed.status === Status.LOCKED, 5000);
        check('locked keyring: status locked, no unlock prompt', feed.status === Status.LOCKED && Main.modalCount === 0,
            {status: feed.status, modal: Main.modalCount});
        check('locked keyring: link forgotten in memory', feed._url === null);
        feed.release();
    }

    disable() {}
}
