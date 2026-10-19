"""Phase 0 probe: what a GTK4/libadwaita popover paints under the user's gtk-4.0 CSS.

Opens a header-bar menu (has-arrow, as Files' ⋯ menu) and a context menu (no arrow, as Files'
right-click) in a window that may carry Files' .nautilus-window class, then writes each
popover's render-node dump, a PNG and its geometry. Run on the Broadway backend.
usage: popover_probe.py OUTDIR [nautilus|plain] [dark|light]
"""
import json, sys
import gi
gi.require_version('Gtk', '4.0'); gi.require_version('Adw', '1')
from gi.repository import Adw, Gio, GLib, Graphene, Gtk

out, kind, scheme = sys.argv[1], (sys.argv[2:3] or ['nautilus'])[0], (sys.argv[3:4] or ['dark'])[0]

def menu_model():
    m = Gio.Menu()
    s1 = Gio.Menu(); s1.append('New Folder…', 'app.x'); s1.append('Open With…', 'app.x')
    sub = Gio.Menu(); sub.append('Text File', 'app.x'); s1.append_submenu('New Document', sub)
    s2 = Gio.Menu(); s2.append('Reload', 'app.x'); s2.append('Copy Location', 'app.x')
    m.append_section(None, s1); m.append_section(None, s2)
    return m

def tree(w, root, depth=0):
    ok, r = w.compute_bounds(root)
    rows = [dict(depth=depth, css=w.get_css_name(), classes=w.get_css_classes(),
                 bounds=[round(r.get_x(), 1), round(r.get_y(), 1), round(r.get_width(), 1), round(r.get_height(), 1)] if ok else None)]
    if depth < 3:
        c = w.get_first_child()
        while c:
            rows += tree(c, root, depth + 1); c = c.get_next_sibling()
    return rows

def dump(name, pop, done):
    surf = pop.get_surface()
    tx, ty = pop.get_surface_transform()
    snap = Gtk.Snapshot()
    paint = Gtk.WidgetPaintable(widget=pop)
    w, h = pop.get_width(), pop.get_height()
    paint.snapshot(snap, w, h)
    node = snap.to_node()
    open(f'{out}/{name}.node', 'wb').write(node.serialize().get_data() if node else b'')
    if node:
        tex = pop.get_native().get_renderer().render_texture(node, None)
        tex.save_to_png(f'{out}/{name}.png')
    info = dict(popover=[w, h], surface=[surf.get_width(), surf.get_height()],
                surface_transform=[tx, ty], has_arrow=pop.get_has_arrow(),
                position=int(pop.get_position()), widgets=tree(pop, pop))
    json.dump(info, open(f'{out}/{name}.json', 'w'), indent=1)
    pop.popdown()
    GLib.timeout_add(300, done)

def on_activate(app):
    Adw.StyleManager.get_default().set_color_scheme(
        Adw.ColorScheme.FORCE_DARK if scheme == 'dark' else Adw.ColorScheme.FORCE_LIGHT)
    win = Adw.ApplicationWindow(application=app, default_width=700, default_height=500)
    if kind == 'nautilus':
        win.add_css_class('nautilus-window')
    app.add_action(Gio.SimpleAction.new('x', None))
    tv = Adw.ToolbarView()
    hb = Adw.HeaderBar()
    mb = Gtk.MenuButton(icon_name='view-more-symbolic', menu_model=menu_model())
    hb.pack_end(mb); tv.add_top_bar(hb)
    area = Gtk.Box(hexpand=True, vexpand=True)
    ctx = Gtk.PopoverMenu.new_from_model(menu_model())
    ctx.set_has_arrow(False); ctx.set_parent(area)
    tv.set_content(area); win.set_content(tv); win.present()

    def step_ctx():
        r = Gdk_rect(200, 150)
        ctx.set_pointing_to(r); ctx.popup()
        GLib.timeout_add(600, lambda: dump('context', ctx, lambda: app.quit()) and False)
        return False
    def step_hb():
        mb.popup()
        GLib.timeout_add(600, lambda: dump('headerbar', mb.get_popover(), step_ctx) and False)
        return False
    GLib.timeout_add(800, step_hb)

def Gdk_rect(x, y):
    gi.require_version('Gdk', '4.0'); from gi.repository import Gdk
    r = Gdk.Rectangle(); r.x, r.y, r.width, r.height = x, y, 1, 1
    return r

app = Adw.Application(application_id='org.example.PopoverProbe', flags=Gio.ApplicationFlags.NON_UNIQUE)
app.connect('activate', on_activate)
app.run([])
