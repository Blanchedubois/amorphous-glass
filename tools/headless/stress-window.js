// stress-window.js [X Y]: a GTK 4 window with a header bar to right-click (the window menu), for
// the window menu cases of the stress test (tools/headless/stress.sh). It stays until it is closed.
imports.gi.versions.Gtk = '4.0';
const { Gtk } = imports.gi;

const app = new Gtk.Application({ application_id: 'org.tahoe.StressWindow' });
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({ application: app, default_width: 640, default_height: 420, title: 'Window menu' });
    window.set_titlebar(new Gtk.HeaderBar());
    window.set_child(new Gtk.Label({ label: 'right-click the header bar' }));
    window.present();
});
app.run([]);
