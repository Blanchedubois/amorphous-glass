// gjs fake-player-app.js MS: a GTK app with a window that is also an MPRIS player (Playing, can
// raise, no desktop file), for the app button test; Raise is only logged, as a player Wayland
// will not let take the focus. Quits after MS.
imports.gi.versions.Gtk = '4.0';
const {Gtk, Gio, GLib} = imports.gi;

const XML = `<node>
<interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/>
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
</interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
</interface></node>`;
const props = {
    Identity: new GLib.Variant('s', 'Fake App Player'),
    DesktopEntry: new GLib.Variant('s', 'local.tahoe.fakeplayer'),
    CanRaise: new GLib.Variant('b', true),
    PlaybackStatus: new GLib.Variant('s', 'Playing'),
    Metadata: new GLib.Variant('a{sv}', {
        'mpris:trackid': new GLib.Variant('o', '/fakeapp/1'),
        'xesam:title': new GLib.Variant('s', 'From The Fake App'),
        'mpris:length': new GLib.Variant('x', 200 * 1e6),
    }),
    Position: new GLib.Variant('x', 0),
    CanGoNext: new GLib.Variant('b', true),
    CanGoPrevious: new GLib.Variant('b', true),
};
const app = new Gtk.Application({application_id: 'local.tahoe.fakeplayer'});
app.connect('activate', () => {
    const w = new Gtk.ApplicationWindow({application: app, title: 'Fake App Player', default_width: 400, default_height: 300});
    w.present();
    const info = Gio.DBusNodeInfo.new_for_xml(XML);
    for (const iface of info.interfaces) {
        Gio.DBus.session.register_object('/org/mpris/MediaPlayer2', iface,
            (c, sender, path, ifaceName, method, params, inv) => {
                print(`called ${method}`);
                inv.return_value(null);
            },
            (c, sender, path, ifaceName, name) => props[name] ?? null, null);
    }
    Gio.DBus.session.own_name('org.mpris.MediaPlayer2.fakeapp', Gio.BusNameOwnerFlags.NONE, null, null);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, Number(ARGV[0] ?? 30000), () => { app.quit(); return GLib.SOURCE_REMOVE; });
});
app.run([]);
