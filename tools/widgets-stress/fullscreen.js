// a fullscreen GTK window for the headless stress test; closes itself after ARGV[0] ms
imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
const app = new Gtk.Application({application_id: 'local.tahoe.fullscreen'});
app.connect('activate', () => {
    const w = new Gtk.ApplicationWindow({application: app});
    w.fullscreen();
    w.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, Number(ARGV[0] ?? 8000), () => { app.quit(); return GLib.SOURCE_REMOVE; });
});
app.run([]);
