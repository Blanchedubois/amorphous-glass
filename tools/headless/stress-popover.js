// stress-popover.js COUNT GAP_MS [quit-open]: a GTK 4 app whose popover menu opens and closes
// COUNT times, GAP_MS apart, then quits (with `quit-open`, while it is open). Run inside the
// throwaway headless shell (tools/headless/stress.sh) to stress the app-dropdown path of
// tahoe-motion: popup windows mapped and destroyed mid-animation.
imports.gi.versions.Gtk = '4.0';
const { Gio, GLib, Gtk } = imports.gi;

const [count = '30', gap = '40', end = ''] = ARGV;
const app = new Gtk.Application({ application_id: 'org.tahoe.StressPopover' });
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({ application: app, default_width: 500, default_height: 360, title: 'stress' });
    const menu = new Gio.Menu();
    ['Open', 'Save', 'Save As…', 'Print', 'Preferences', 'About'].forEach(label => menu.append(label, 'app.none'));
    const popover = new Gtk.PopoverMenu({ menu_model: menu });
    const button = new Gtk.MenuButton({ label: 'Menu', popover, halign: Gtk.Align.CENTER, valign: Gtk.Align.START });
    window.set_child(button);
    window.present();
    let n = 0;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, Number(gap), () => {
            if (n % 2 === 0)
                popover.popup();
            else
                popover.popdown();
            if (++n >= Number(count) * 2) {
                if (end === 'quit-open') {
                    popover.popup();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => app.quit());
                    return GLib.SOURCE_REMOVE;
                }
                popover.popdown();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => app.quit());
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
