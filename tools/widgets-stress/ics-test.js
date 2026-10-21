// gjs -m tools/widgets-stress/ics-test.js: runs the Schedule widgets' ICS helper
// (extensions/tahoe-widgets@cachyos-tahoe/ics-expand.js) on every fixture in ics/ with a fixed
// time zone and window, and compares with ics/expected.json (worked out by hand).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const helper = GLib.build_filenamev([here, '..', '..', 'extensions', 'tahoe-widgets@cachyos-tahoe', 'ics-expand.js']);
const {cases} = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${here}/ics/expected.json`)[1]));

function line(e, zone) {
    const t = s => GLib.DateTime.new_from_unix_utc(s).to_timezone(zone).format('%Y-%m-%dT%H:%M');
    const when = e.allDay ? `D ${e.startDate}..${e.endDate}` : `${t(e.start)}..${t(e.end)}`;
    return [e.title, when, e.color].filter(Boolean).join('|');
}

let failed = 0;
for (const c of cases) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('TZ', c.tz, true);
    const t0 = GLib.get_monotonic_time();
    const p = launcher.spawnv(['gjs', '-m', helper, `${here}/ics/${c.file}`, '--from', c.from, '--to', c.to]);
    const [, out, err] = p.communicate_utf8(null, null);
    const ms = Math.round((GLib.get_monotonic_time() - t0) / 1000);
    let got = [];
    let ok = p.get_exit_status() === c.exit;
    if (ok && c.exit === 0) {
        const data = JSON.parse(out);
        got = data.events.map(e => line(e, GLib.TimeZone.new_identifier(c.tz)));
        ok = JSON.stringify(got) === JSON.stringify(c.expect) && data.tz === c.tz;
    }
    if (c.exit !== 0)
        ok &&= out.trim() === '';
    print(`${ok ? 'ok  ' : 'FAIL'} ${c.file} ${c.tz} ${c.from}: ${c.name} (${ms} ms)`);
    if (!ok) {
        failed++;
        print(`  exit ${p.get_exit_status()} (want ${c.exit}) ${err.trim()}`);
        print(`  want:\n    ${c.expect.join('\n    ')}\n  got:\n    ${got.join('\n    ')}`);
    }
}
print(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} cases ok`);
System.exit(failed ? 1 : 0);
