// Headless only: writes each glass mode to the throwaway state file, screenshots the widget area,
// logs JS errors, then ends the shell. Output dir: $SHOT_OUT, area: $SHOT_RECT "x,y,w,h".
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('SHOT_OUT');
const RECT = (GLib.getenv('SHOT_RECT') ?? '0,0,1200,800').split(',').map(Number);
const MODES = (GLib.getenv('SHOT_MODES') ?? 'light,dark,milky').split(',');
const WAIT = Number(GLib.getenv('SHOT_WAIT') ?? 6000);
const STATE = GLib.build_filenamev([GLib.get_user_config_dir(), 'tahoe-glass', 'state']);
function log(msg) {
    const f = Gio.File.new_for_path(`${OUT}/driver.log`);
    const st = f.append_to(Gio.FileCreateFlags.NONE, null);
    st.write_all(new TextEncoder().encode(`${msg}\n`), null);
    st.close(null);
}
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));

async function shot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot_area(...RECT, stream,
        (o, res) => { try { o.screenshot_area_finish(res); resolve(); } catch (e) { reject(e); } }));
    await new Promise(resolve => stream.close_async(0, null, () => resolve()));
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
        return log('no dock pipeline');
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

// a fake MPRIS player (only when SHOT_FAKE_PLAYER=1): made-up song, generated art, sidecar .lrc
const MPRIS_XML = `<node>
<interface name="org.mpris.MediaPlayer2"><property name="Identity" type="s" access="read"/></interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
</interface></node>`;
function fakePlayer() {
    const art = `${OUT}/art.png`;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 300, 300);
    const cr = new Cairo.Context(surface);
    const g = new Cairo.LinearGradient(0, 0, 300, 300);
    g.addColorStopRGB(0, 0.98, 0.45, 0.25);
    g.addColorStopRGB(1, 0.35, 0.20, 0.85);
    cr.setSource(g);
    cr.paint();
    cr.setSourceRGBA(1, 1, 1, 0.85);
    cr.arc(150, 150, 70, 0, 2 * Math.PI);
    cr.fill();
    surface.writeToPNG(art);
    cr.$dispose();
    GLib.file_set_contents(`${OUT}/song.lrc`, [
        '[00:30.00]First line of a made-up song', '[00:36.00]The second line, a bit longer than the first',
        '[00:41.00]Third line', '[00:46.00]A fourth line comes in here', '[00:52.00]', '[00:55.00]Sixth line',
        '[01:00.00]Seventh line', '[01:05.00]Eighth line'].join('\n'));
    const info = Gio.DBusNodeInfo.new_for_xml(MPRIS_XML);
    const props = {
        Identity: new GLib.Variant('s', 'Fake Player'),
        PlaybackStatus: new GLib.Variant('s', 'Playing'),
        Metadata: new GLib.Variant('a{sv}', {
            'mpris:trackid': new GLib.Variant('o', '/fake/track/1'),
            'xesam:title': new GLib.Variant('s', 'Made-Up Song Title'),
            'xesam:artist': new GLib.Variant('as', ['Test Artist']),
            'xesam:album': new GLib.Variant('s', 'Test Album'),
            'xesam:url': new GLib.Variant('s', `file://${OUT}/song.ogg`),
            'mpris:artUrl': new GLib.Variant('s', `file://${art}`),
            'mpris:length': new GLib.Variant('x', 214 * 1e6),
        }),
        Position: new GLib.Variant('x', 38 * 1e6),
        CanGoNext: new GLib.Variant('b', true),
        CanGoPrevious: new GLib.Variant('b', true),
    };
    for (const iface of info.interfaces) {
        Gio.DBus.session.register_object('/org/mpris/MediaPlayer2', iface,
            (c, sender, path, ifaceName, method, params, invocation) => invocation.return_value(null),
            (c, sender, path, ifaceName, name) => props[name] ?? null, null);
    }
    Gio.DBus.session.own_name('org.mpris.MediaPlayer2.fake', Gio.BusNameOwnerFlags.NONE, null, null);
}

export default class Shot extends Extension {
    enable() {
        log('enable');
        if (GLib.getenv('SHOT_FAKE_PLAYER'))
            fakePlayer(); this._run().catch(e => log(`error: ${e}\n${e.stack}`))
            .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
    }
    async _run() {
        await sleep(WAIT);
        Main.overview.hide();
        await sleep(1500);
        for (const mode of MODES) {
            setTint(mode);
            GLib.file_set_contents(STATE, `widgets=on\nmode=${mode}\n`);
            await sleep(2500);
            await shot(mode);
            log(`shot ${mode}`);
        }
    }
    disable() {}
}
