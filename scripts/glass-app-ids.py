#!/usr/bin/env python3
# glass-app-ids.py: Blur My Shell's application whitelist, printed as a GVariant string list.
#
# The GTK4 and GTK3 glass blocks (glass-bar.sh gtk_glass, gtk3_glass) make the backgrounds of
# every GTK app translucent, so every GTK app needs Liquid Glass live blur behind it, or it shows
# the desktop unblurred. This finds them from the desktop entries: the binary an entry launches
# links GTK 4 or 3, or is a script that loads GTK / libadwaita / pywebview (a Python entry point
# counts when its environment has pywebview or PyGObject), or a Flatpak on the GNOME runtime. On
# Wayland a GTK window's class is its application ID: the desktop entry's name, or StartupWMClass.
# A few apps are listed by hand, as before (KDE ones among them).
import configparser, glob, os, shutil

EXTRA = ['org.gnome.Nautilus', 'org.gnome.Settings', 'gnome-control-center', 'org.gnome.Console', 'kgx',
         'org.gnome.TextEditor', 'org.gnome.Calculator', 'org.gnome.Loupe', 'org.gnome.Papers',
         'org.gnome.Characters', 'org.gnome.clocks', 'org.gnome.Calendar', 'org.gnome.Weather',
         'org.gnome.Music', 'org.gnome.Software', 'org.gnome.DiskUtility', 'org.gnome.baobab',
         'org.gnome.SystemMonitor', 'org.gnome.tweaks', 'org.gnome.Extensions', 'org.gnome.Logs',
         'org.gnome.font-viewer', 'org.kde.dolphin', 'org.kde.kate', 'org.kde.konsole',
         # X11 apps whose GNOME title bar (mutter-x11-frames, GTK4) gets the glass: Spotify
         'spotify']
# never: games, launchers and VR (they stay unblurred and fast; see glass-bar.sh apps())
NEVER = {'steam', 'steamwebhelper', 'VRChat.exe', 'vrmonitor', 'vrcompositor', 'vrwebhelper'}

data_dirs = [os.path.expanduser('~/.local/share')] + \
    os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share').split(':') + \
    ['/var/lib/flatpak/exports/share', os.path.expanduser('~/.local/share/flatpak/exports/share')]

def is_gtk(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(4)
            if head == b'\x7fELF':   # the soname sits in the dynamic string table
                body = f.read()
                return b'libgtk-4.so' in body or b'libgtk-3.so' in body
            if head[:2] != b'#!':
                return False
            first = (head + f.readline()).decode('utf-8', 'replace')
            text = f.read(200000).decode('utf-8', 'replace')
    except OSError:
        return False
    if any(k in text for k in ("'Gtk'", '"Gtk"', 'gi://Gtk', 'imports.gi.Gtk', 'Adw', 'libadwaita', 'webview')):
        return True
    # a Python entry point (pip console script): look in the interpreter's environment
    interp = first[2:].split()[0] if len(first) > 2 else ''
    if 'python' in os.path.basename(interp):
        env = os.path.dirname(os.path.dirname(interp))
        return any(glob.glob(f'{env}/lib/python*/site-packages/{m}') for m in ('webview', 'gi'))
    return False

def flatpak_gnome(app_id):
    for root in ('/var/lib/flatpak/app', os.path.expanduser('~/.local/share/flatpak/app')):
        try:
            return 'runtime=org.gnome.Platform' in open(f'{root}/{app_id}/current/active/metadata').read()
        except OSError:
            continue
    return False

ids, seen = set(), set()
for d in data_dirs:
    for path in sorted(glob.glob(f'{d}/applications/*.desktop')):
        name = os.path.basename(path)[:-len('.desktop')]
        if name in seen:   # the first data dir wins, as in GLib
            continue
        seen.add(name)
        cp = configparser.ConfigParser(interpolation=None, strict=False)
        try:
            cp.read(path, encoding='utf-8')
            e = cp['Desktop Entry']
        except (configparser.Error, KeyError, UnicodeDecodeError):
            continue
        argv = e.get('Exec', '').split()
        while argv and (argv[0] == 'env' or '=' in argv[0]):
            argv.pop(0)
        if not argv:
            continue
        if argv[0].endswith('flatpak'):
            app = e.get('X-Flatpak', name)
            gtk = flatpak_gnome(app)
        else:
            exe = shutil.which(argv[0])
            gtk = bool(exe) and is_gtk(exe)
        if gtk:
            ids.add(name)
            if e.get('StartupWMClass'):
                ids.add(e['StartupWMClass'])

out = EXTRA + sorted(i for i in ids - set(EXTRA) - NEVER)
print('[' + ', '.join(f"'{i}'" for i in out) + ']')
