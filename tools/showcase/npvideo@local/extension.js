// npvideo@local: films Tahoe Now Playing for the showcase (tools/showcase/screensaver-video.sh), in a
// throwaway headless shell only. GNOME's own screencast records the whole screen at 60 fps with the
// cursor while this drives it: a pretend player plays the chosen song (its name and real cover; the
// lyrics are our own placeholder lines, never the song's), the view opens with its enter animation,
// the cursor glides over the cover so it tilts and catches the light, rests on the lyrics, presses
// Next (a song without lyrics: the layout re-centres), and Escape closes it. Marks go to
// $NPV_OUT/marks.jsonl in seconds from the recording's start.
//   NPV_TITLE, NPV_ARTIST, NPV_ALBUM, NPV_COVER (a file), NPV_TITLE2 (the second song, no lyrics)

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('NPV_OUT');
const UUID = 'tahoe-nowplaying@cachyos-tahoe';
const env = (k, d) => GLib.getenv(k) ?? d;
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const now = () => GLib.get_monotonic_time();
const np = () => Main.extensionManager.lookup(UUID)?.stateObj;

function write(obj) {
    const f = Gio.File.new_for_path(`${OUT}/marks.jsonl`);
    const s = f.append_to(Gio.FileCreateFlags.NONE, null);
    s.write_all(new TextEncoder().encode(JSON.stringify(obj) + '\n'), null);
    s.close(null);
}

// the placeholder lyrics (tools/showcase/fakeplayer.py's lines), one every 3 s
const LINES = [
    'Placeholder lyrics, written for this demo',
    'Not the words of the song on the card',
    'Each line drifts up when its time comes',
    'The sung line grows, the others fade back',
    'A wave runs down the column, line by line',
    'The glass takes its colours from the cover',
    'Slow ribbons turning under the text',
    'Timed in a file that sits beside the track',
    'Nothing here was fetched from the web',
    'Back to the top, and round again',
];

const MPRIS_XML = `<node>
<interface name="org.mpris.MediaPlayer2"><method name="Raise"/><property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/><property name="CanRaise" type="b" access="read"/></interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Play"/><method name="Pause"/><method name="Stop"/>
  <method name="Next"/><method name="Previous"/>
  <method name="Seek"><arg type="x" direction="in"/></method>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
</interface></node>`;

class Player {
    constructor() {
        let lrc = '';
        for (let t = 0, i = 0; t < 240; t += 3, i++)
            lrc += `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}.00]${LINES[i % LINES.length]}\n`;
        GLib.file_set_contents(`${OUT}/song1.lrc`, lrc);
        GLib.file_set_contents(`${OUT}/song2.lrc`, '[re:no synced lines: the layout without lyrics]\n');
        const cover = `file://${env('NPV_COVER', '')}`;
        this.tracks = [
            {id: '/npv/1', title: env('NPV_TITLE', 'Hey Ladies'), file: 'song1', length: 227},
            {id: '/npv/2', title: env('NPV_TITLE2', 'Shake Your Rump'), file: 'song2', length: 199},
        ].map(t => ({...t, artist: env('NPV_ARTIST', 'Beastie Boys'), album: env('NPV_ALBUM', "Paul's Boutique"), art: cover}));
        this.index = 0;
        this.position = 41;
        this.since = now();
        this.ids = [];
        for (const iface of Gio.DBusNodeInfo.new_for_xml(MPRIS_XML).interfaces) {
            this.ids.push(Gio.DBus.session.register_object('/org/mpris/MediaPlayer2', iface,
                (c, s, p, i, method, params, inv) => { this.method(method); inv.return_value(null); },
                (c, s, p, i, name) => this.props()[name] ?? null, null));
        }
        Gio.DBus.session.own_name('org.mpris.MediaPlayer2.showcase', Gio.BusNameOwnerFlags.NONE, null, null);
    }

    props() {
        const t = this.tracks[this.index];
        return {
            Identity: new GLib.Variant('s', 'Showcase'),
            DesktopEntry: new GLib.Variant('s', 'showcase'),
            CanRaise: new GLib.Variant('b', false),
            PlaybackStatus: new GLib.Variant('s', 'Playing'),
            Metadata: new GLib.Variant('a{sv}', {
                'mpris:trackid': new GLib.Variant('o', t.id),
                'xesam:title': new GLib.Variant('s', t.title),
                'xesam:artist': new GLib.Variant('as', [t.artist]),
                'xesam:album': new GLib.Variant('s', t.album),
                'xesam:url': new GLib.Variant('s', `file://${OUT}/${t.file}.flac`),
                'mpris:artUrl': new GLib.Variant('s', t.art),
                'mpris:length': new GLib.Variant('x', t.length * 1e6),
            }),
            Position: new GLib.Variant('x', Math.round((this.position + (now() - this.since) / 1e6) * 1e6)),
            CanGoNext: new GLib.Variant('b', true),
            CanGoPrevious: new GLib.Variant('b', true),
            CanSeek: new GLib.Variant('b', true),
        };
    }

    method(name) {
        if (name === 'Next' || name === 'Previous') {
            this.index = (this.index + 1) % this.tracks.length;
            this.position = 0;
            this.since = now();
            Gio.DBus.session.emit_signal(null, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
                'PropertiesChanged', new GLib.Variant('(sa{sv}as)', ['org.mpris.MediaPlayer2.Player',
                    {Metadata: this.props().Metadata}, []]));
        }
    }
}

export default class NpVideo extends Extension {
    enable() {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this.run().catch(e => write({label: 'error', error: String(e), stack: e.stack}))
                .finally(() => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => { global.context.terminate(); return GLib.SOURCE_REMOVE; }));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {}

    async run() {
        Main.overview.hide();
        const seat = global.stage.get_context().get_backend().get_default_seat();
        const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let px = global.screen_width / 2, py = global.screen_height * 0.62;
        ptr.notify_absolute_motion(now(), px, py);
        // a glide that starts at speed and settles (ease-out), 60 steps a second
        const glide = async (x, y, ms) => {
            const x0 = px, y0 = py, steps = Math.max(1, Math.round(ms / 16));
            for (let i = 1; i <= steps; i++) {
                const e = 1 - (1 - i / steps) ** 3;
                px = x0 + (x - x0) * e;
                py = y0 + (y - y0) * e;
                ptr.notify_absolute_motion(now(), px, py);
                await sleep(16);
            }
        };
        const click = async () => {
            ptr.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            await sleep(70);
            ptr.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        };
        const centreOf = a => {
            const [x, y] = a.get_transformed_position();
            const [w, h] = a.get_transformed_size();
            return [x + w / 2, y + h / 2, w, h];
        };

        new Player();
        await sleep(1500);

        const bus = Gio.DBus.session;
        const call = (method, params, type) => new Promise((resolve, reject) => bus.call('org.gnome.Shell.Screencast',
            '/org/gnome/Shell/Screencast', 'org.gnome.Shell.Screencast', method, params, type, Gio.DBusCallFlags.NONE,
            -1, null, (b, res) => { try { resolve(b.call_finish(res).deepUnpack()); } catch (e) { reject(e); } }));
        const file = `${OUT}/screensaver`;
        const opts = {framerate: new GLib.Variant('i', 60), 'draw-cursor': new GLib.Variant('b', true)};
        const started = await call('Screencast', new GLib.Variant('(sa{sv})', [file, opts]), new GLib.VariantType('(bs)'));
        const t0 = now();
        const mark = label => write({label: 'mark', mark: label, t: (now() - t0) / 1e6});
        await sleep(1200);

        mark('open');
        np().toggle();
        await sleep(400);
        for (let i = 0; i < 100 && np().overlay?.view?.entering !== false; i++)
            await sleep(50);
        mark('entered');
        await sleep(1500);                         // the swirl, the lyrics drifting, the clock

        const view = np().overlay.view;
        const [cx, cy, cw, ch] = centreOf(view.parts.cover);
        mark('cover');
        await glide(cx - cw * 0.05, cy + ch * 0.1, 1100);     // onto the cover: it leans toward the cursor
        await sleep(700);
        await glide(cx - cw * 0.32, cy - ch * 0.32, 1300);    // to its top left corner: a glint on the rim
        await sleep(600);
        await glide(cx + cw * 0.32, cy - ch * 0.28, 1500);    // across the top
        await sleep(500);
        await glide(cx + cw * 0.3, cy + ch * 0.32, 1300);     // down the right
        await sleep(700);
        mark('off-cover');
        const [lx, ly] = centreOf(view.parts.lyrics);
        await glide(lx, ly, 1400);                 // off the cover (it springs back) onto the lyrics
        await sleep(2200);

        mark('next');
        const next = view.controls['next'];
        const [nx, ny] = centreOf(next);
        await glide(nx, ny, 1200);
        await sleep(400);
        await click();                             // a song without lyrics: the layout re-centres
        await sleep(3200);
        mark('escape');
        kbd.notify_keyval(now(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
        kbd.notify_keyval(now() + 1000, Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
        await sleep(1500);
        mark('stop');

        const stopped = await call('StopScreencast', null, new GLib.VariantType('(b)'));
        await sleep(1500);
        const kept = `${file}-take.mp4`;
        Gio.File.new_for_path(`${file}.mp4`).copy(Gio.File.new_for_path(kept), Gio.FileCopyFlags.OVERWRITE, null, null);
        try {
            const [pid] = await new Promise((resolve, reject) => bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'GetConnectionUnixProcessID', new GLib.Variant('(s)', ['org.gnome.Shell.Screencast']),
                new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, null,
                (b, res) => { try { resolve(b.call_finish(res).deepUnpack()); } catch (e) { reject(e); } }));
            GLib.spawn_command_line_async(`kill ${pid}`);
        } catch (e) {
            write({label: 'service', error: String(e)});
        }
        write({label: 'done', started, stopped, file: kept});
    }
}
