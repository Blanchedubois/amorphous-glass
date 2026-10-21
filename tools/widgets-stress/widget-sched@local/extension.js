// Headless only (never installed): the Schedule widgets with a fake clock (schedule.js
// setClockForTests) over a made-up calendar dated today, served from 127.0.0.1 (ics-server.py).
// Checks what the rows say across the day and past midnight, overflow, the feed's states, and
// that an idle minute tick changes no actors. Screenshots of the states per mode with SCHED_SHOTS=1.
// Results in $SHOT_OUT/sched.jsonl.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('SHOT_OUT');
const UUID = 'tahoe-widgets@cachyos-tahoe';
const CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass']);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
function write(obj) {
    const st = Gio.File.new_for_path(`${OUT}/sched.jsonl`).append_to(Gio.FileCreateFlags.NONE, null);
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
    while (GLib.get_monotonic_time() < end && !fn())
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
    return Boolean(fn());
}

// the same day as schedule-test.js, dated today (floating local times)
function calendar(d0) {
    const day = n => d0.add_days(n).format('%Y%m%d');
    const ev = (uid, s, e, title) => `BEGIN:VEVENT\nUID:${uid}@live.test\nDTSTAMP:20260101T000000Z\n${s}\n${e}\nSUMMARY:${title}\nEND:VEVENT`;
    const t = (uid, sd, st, ed, et, title) => ev(uid, `DTSTART:${day(sd)}T${st}00`, `DTEND:${day(ed)}T${et}00`, title);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tahoe-widgets//live//EN',
        t('trip', -1, '0800', 2, '1800', 'Trip'), t('overnight', -1, '2200', 0, '0200', 'Overnight'),
        ev('holiday', `DTSTART;VALUE=DATE:${day(0)}`, `DTEND;VALUE=DATE:${day(1)}`, 'Holiday'),
        t('standup', 0, '0930', 0, '0945', 'Standup'), t('gym', 0, '1030', 0, '1145', 'Gym'),
        t('lunch', 0, '1315', 0, '1415', 'Lunch with Sam'), t('conf', 0, '1500', 3, '1200', 'Conference'),
        t('late', 0, '2300', 1, '0100', 'Late show'), t('tomorrow', 1, '0900', 1, '1000', 'Tomorrow'),
        'END:VCALENDAR', ''].join('\n');
}

// the dock pipeline's tint per mode, as glass_params() in glass-bar.sh writes it
const TINT = {light: [0.18, [1, 1, 1, 1]], dark: [0.42, [0.133, 0.133, 0.149, 1]], milky: [0.12, [1, 1, 1, 1]]};
function setTint(mode) {
    const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
    const src = Gio.SettingsSchemaSource.new_from_directory(`${ext.path}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: src.lookup('org.gnome.shell.extensions.blur-my-shell', false)});
    const pipelines = settings.get_value('pipelines').recursiveUnpack();
    const p = pipelines.pipeline_glassbar_dock;
    if (!p)
        return write({info: 'no dock pipeline'});
    const fx = p.effects[0];
    fx.params.tint = TINT[mode][0];
    fx.params.tint_color = TINT[mode][1];
    const pack = (v) => {
        if (typeof v === 'number') return new GLib.Variant('d', v);
        if (typeof v === 'string') return new GLib.Variant('s', v);
        if (typeof v === 'boolean') return new GLib.Variant('b', v);
        if (Array.isArray(v) && v.every(x => typeof x === 'number')) return new GLib.Variant('ad', v);
        if (Array.isArray(v)) return new GLib.Variant('av', v.map(x => new GLib.Variant('a{sv}', Object.fromEntries(Object.entries(x).map(([k, y]) => [k, pack(y)])))));
        return new GLib.Variant('a{sv}', Object.fromEntries(Object.entries(v).map(([k, y]) => [k, pack(y)])));
    };
    const out = {};
    for (const [id, pl] of Object.entries(pipelines))
        out[id] = {name: new GLib.Variant('s', pl.name), effects: pack(pl.effects)};
    settings.set_value('pipelines', new GLib.Variant('a{sa{sv}}', out));
}

const labels = actor => {
    const out = [];
    const walk = a => {
        if (a instanceof St.Label && a.visible && a.opacity > 0 && a.text)
            out.push(a.text);
        a.get_children().forEach(walk);
    };
    walk(actor);
    return out;
};

async function shot(name) {
    const stream = Gio.File.new_for_path(`${OUT}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(0, 40, 808, 610, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
}

export default class SchedTest extends Extension {
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
        const d0 = GLib.DateTime.new_now_local();
        const dir = GLib.dir_make_tmp('ics-live-XXXXXX');
        GLib.file_set_contents(`${dir}/live.ics`, calendar(d0));
        this._server = Gio.Subprocess.new(['python3', '-I', `${GLib.getenv('STRESS_HARNESS')}/ics-server.py`, `${dir}/port`, dir], Gio.SubprocessFlags.NONE);
        await waitFor(() => GLib.file_test(`${dir}/port`, GLib.FileTest.EXISTS), 5000);
        const port = new TextDecoder().decode(GLib.file_get_contents(`${dir}/port`)[1]).trim();
        const serve = m => GLib.spawn_command_line_sync(`python3 -I -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/_mode?m=${m}')"`);

        const ext = Main.extensionManager.lookup(UUID);
        const {setClockForTests} = await import(`file://${ext.path}/schedule.js`);
        const {acquireFeed, Status} = await import(`file://${ext.path}/icsfeed.js`);
        const feed = acquireFeed();
        const entries = ext.stateObj._entries;
        const small = entries.find(e => e.spec.type === 'schedule-small').widget;
        const large = entries.find(e => e.spec.type === 'schedule-large').widget;

        let fake = null;
        setClockForTests(() => fake);
        const set = (days, h, m, s = 0) => {
            fake = GLib.DateTime.new_local(d0.get_year(), d0.get_month(), d0.get_day_of_month(), h, m, s).add_days(days);
            small.tick();
            large.tick();
        };
        set(0, 9, 21, 30);
        GLib.file_set_contents_full(`${CONF}/calendar-url`, `http://127.0.0.1:${port}/live/live.ics\n`, GLib.FileSetContentsFlags.CONSISTENT, 0o600);
        GLib.file_set_contents_full(`${CONF}/calendar-source`, 'store=file\nchanged=1\n', GLib.FileSetContentsFlags.CONSISTENT, 0o600);
        await waitFor(() => feed.status === Status.OK && feed.events.length > 0, 15000);
        set(0, 9, 21, 30);
        const S = () => labels(small.actor), L = () => labels(large.actor);
        const has = (list, ...want) => want.every(w => list.includes(w));
        write({at: '09:21:30', small: S(), large: L()});
        check('09:21:30 small: weekday, all-day row, next with "in 9 min", +4 more', has(S(), d0.format('%A').toUpperCase(),
            'All day', 'Trip +1', '9:30 AM  in 9 min', 'Standup', '+4 more') && !S().includes('Gym'), {small: S()});
        check('09:21:30 large: 4 rows with ranges, +2 more', has(L(), d0.format('%B'),
            `Today, ${d0.format('%A')}`, '9:30 – 9:45 AM  in 9 min', '10:30 – 11:45 AM', '1:15 – 2:15 PM', '+2 more') &&
            !L().includes('Conference'), {large: L()});

        // an idle minute: no actors change
        let fills = 0;
        for (const w of [small, large]) {
            const orig = w._fill.bind(w);
            w._fill = (...a) => { fills++; return orig(...a); };
        }
        const t0 = GLib.get_monotonic_time();
        for (let i = 0; i < 100; i++) {
            small.tick();
            large.tick();
        }
        const perTick = (GLib.get_monotonic_time() - t0) / 200;
        check('same minute, 100 ticks each: rows not rebuilt', fills === 0, {fills, usPerTick: Math.round(perTick)});
        set(0, 12, 0);
        fills = 0;
        set(0, 12, 1);   // "in 1 h" either way: nothing to change
        check('12:00 to 12:01: the same words, nothing rebuilt', fills === 0, {fills});
        set(0, 12, 50);
        fills = 0;
        set(0, 12, 51);  // "in 25 min" to "in 24 min"
        check('12:50 to 12:51: "in N min" changes, rows rebuilt once each', fills === 2, {fills});

        set(0, 9, 30);
        check('09:30: now, in the bar colour', has(S(), 'Now · until 9:45 AM') && has(L(), 'Now · until 9:45 AM', '10:30 – 11:45 AM  in 1 h'), {small: S()});
        set(0, 9, 45);
        check('09:45: the standup has left; Gym next', !S().includes('Standup') && has(S(), '10:30 AM  in 45 min'), {small: S()});
        set(0, 16, 0);
        check('16:00: an event ending in three days', has(L(), `Now · until ${d0.add_days(3).format('%a')}`, 'From 11:00 PM'), {large: L()});
        set(0, 23, 59, 59);
        const headBefore = labels(small.actor)[0];
        set(1, 0, 0, 30);
        write({at: 'next day 00:00:30', small: S(), large: L()});
        check('midnight: header and rows roll over', headBefore === d0.format('%A').toUpperCase() &&
            has(S(), d0.add_days(1).format('%A').toUpperCase(), String(d0.add_days(1).get_day_of_month()), 'Trip +1', 'Now · until 1:00 AM') &&
            has(L(), `Today, ${d0.add_days(1).format('%A')}`, '9:00 – 10:00 AM') && !L().includes('Holiday'), {small: S(), large: L()});
        set(3, 20, 0);
        check('nothing left: "No more events today"', has(S(), 'No more events today') && has(L(), 'No more events today'), {small: S()});

        const shots = GLib.getenv('SCHED_SHOTS');
        const modeShots = async name => {
            if (!shots)
                return;
            for (const mode of ['light', 'dark']) {
                setTint(mode);   // the glass's own tint per mode, as widget-shot@local
                GLib.file_set_contents(`${CONF}/state`, `widgets=on\nmode=${mode}\n`);
                // eslint-disable-next-line no-await-in-loop
                await sleep(1800);
                // eslint-disable-next-line no-await-in-loop
                await shot(`${name}-${mode}`);
            }
        };
        set(0, 9, 21, 30);
        await modeShots('next');
        set(0, 11, 0);
        await modeShots('now');
        set(3, 20, 0);
        await modeShots('empty');

        // the feed's states
        set(0, 11, 0);
        serve('500');
        feed._lastAttempt = 0;
        feed._soon(0);
        await waitFor(() => feed.status === Status.OFFLINE, 8000);
        small.tick();
        large.tick();
        check('offline with a copy: rows stay, a footer says so with the time', S().some(t => t.startsWith("Can't reach calendar\nupdated ")) &&
            L().some(t => t.startsWith("Can't reach calendar · updated ")) && has(S(), 'Now · until 11:45 AM'), {small: S(), large: L()});
        await modeShots('offline');
        set(3, 20, 0);
        check('offline, nothing left today', S().some(t => t.startsWith("Can't reach calendar · updated")) && has(S(), 'No more events today'), {small: S()});
        feed._setStatus(Status.LOCKED);
        set(0, 11, 0);
        check('locked keyring with a copy: rows and a footer', has(S(), 'Calendar locked', 'Now · until 11:45 AM'), {small: S()});
        serve('ok');
        GLib.file_set_contents_full(`${CONF}/calendar-source`, 'store=none\nchanged=2\n', GLib.FileSetContentsFlags.CONSISTENT, 0o600);
        await waitFor(() => feed.status === Status.NONE, 5000);
        set(0, 11, 0);
        check('link removed: no events of it, "No calendar link"', has(S(), 'No calendar link', 'tahoe-widgets.sh calendar-url') &&
            feed.events.length === 0 && !S().includes('Gym'), {small: S(), events: feed.events.length});
        await modeShots('nolink');
        setClockForTests(null);
        feed.release();
    }

    disable() {}
}
