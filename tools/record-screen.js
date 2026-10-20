// record-screen.js FILE SECONDS: records the whole 2560x1440 screen at 60 fps with GNOME's own
// screencast service (it stops when its caller leaves the bus, so this script stays connected).
// Used to find the menu-skimming artifact, 2026-10-19. Run: gjs tools/record-screen.js /tmp/x 20
// holds the session bus connection open while GNOME records (it stops when the caller leaves)
const { Gio, GLib } = imports.gi;
const [file, seconds] = ARGV;
const bus = Gio.DBus.session;
const call = (method, params, type) => bus.call_sync('org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast',
    'org.gnome.Shell.Screencast', method, params, type, Gio.DBusCallFlags.NONE, -1, null);
const opts = { framerate: new GLib.Variant('i', 60), 'draw-cursor': new GLib.Variant('b', true) };
print(call('ScreencastArea', new GLib.Variant('(iiiisa{sv})', [0, 0, 2560, 1440, file, opts]), new GLib.VariantType('(bs)')).deepUnpack());
const loop = new GLib.MainLoop(null, false);
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Number(seconds), () => {
    print(call('StopScreencast', null, new GLib.VariantType('(b)')).deepUnpack());
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
