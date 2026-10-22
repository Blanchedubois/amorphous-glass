#!/usr/bin/env python3
"""montage_shoot.py OUTDIR [SHOT..] [--dry-run]: the montage reshoot (docs/showcase/montage/REWRITE.md).

Records each shot of the screenplay as GNOME's own screencast (2560x1440, 60 fps, cursor drawn),
driven through the showcase driver (tools/showcase@local), and logs every pointer move, drag and
click with its time in OUTDIR/montage.jsonl, so the edit knows exactly where the cursor is (the
locked camera keeps it in the middle of every frame).

Before the shots it sets the desktop up, and puts everything back afterwards (also on Ctrl+C or
an error):
  - the widgets move out of the way of the popups (quick settings and the calendar open over bare
    wallpaper); the user's ~/.config/tahoe-glass/widgets.json is copied aside and restored;
  - Spotify (or any player that is playing) is paused, and tools/showcase/fakeplayer.py plays
    instead: placeholder lyrics, an abstract cover, no song's words or artwork on camera;
  - Files and Settings open as normal windows (not maximised); their window state is restored;
  - an empty workspace, so no open window is on camera.

It never locks the screen and never types a password (the driver refuses Super+L): the lock screen
is recorded in a throwaway shell by tools/showcase/lock-video.sh.

  --dry-run   print the plan and the layout, change nothing
  TAHOE_SHOWCASE_SONG=song.json   the song the fake player shows (fakeplayer.py --song): its name
              and cover, with the placeholder lyrics
  TAHOE_SHOWCASE_PLAYER=spotify   no fake player: the user's own Spotify plays on, so the widgets show
              the real song, cover and synced lyrics (the Lyrics widget fetches them from lrclib.net
              itself, user's choice 2026-10-21); it is moved to TAHOE_SHOWCASE_SEEK seconds (default
              60) so the track does not end mid-shoot; TAHOE_SHOWCASE_TRACK=spotify:track:... opens
              that song first (the player may have moved on to another)
"""
import json, os, shutil, signal, subprocess, sys, time

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = [a for a in sys.argv[1:] if not a.startswith('-')]
DRY = '--dry-run' in sys.argv
# user, 2026-10-21: "take the entire clip of moving around the OS ... all in one take", the camera
# zooming in and following the mouse where needed (docs/showcase/montage/tour.py)
ONE_TAKE = '--one-take' in sys.argv
OUT = os.path.abspath(ARGS[0]) if ARGS else sys.exit(__doc__)
LAYOUT = os.path.expanduser('~/.config/tahoe-glass/widgets.json')
WIDGETS_UUID = 'tahoe-widgets@cachyos-tahoe'
SCREEN = (2560, 1440)
HOME_XY = (1280, 760)          # where the cursor rests between shots, and where the montage begins

# the widgets for the shoot: the left two columns, nothing under the popups (REWRITE.md)
SHOOT_LAYOUT = {'widgets': [
    {'type': 'music-large', 'monitor': 0, 'x': 16, 'y': 64},
    {'type': 'music-lyrics', 'monitor': 0, 'x': 16, 'y': 584},
    {'type': 'clock-analog-quarters', 'monitor': 0, 'x': 392, 'y': 64},
    {'type': 'weather-large', 'monitor': 0, 'x': 392, 'y': 250},
    {'type': 'schedule-large', 'monitor': 0, 'x': 392, 'y': 622},
]}

BUS = None
LOG = None
POS = list(HOME_XY)


# ---- the driver, every pointer action logged ---------------------------------------------------
def call(method, args=None, sig=None, out=None, dest='org.cachyos.TahoeShowcase', path='/org/cachyos/TahoeShowcase',
         iface='org.cachyos.TahoeShowcase', timeout=30000):
    v = GLib.Variant(sig, args) if sig else None
    r = BUS.call_sync(dest, path, iface, method, v, GLib.VariantType(out) if out else None,
                      Gio.DBusCallFlags.NONE, timeout, None)
    return r.unpack() if r else None


def log(**kv):
    kv['t'] = round(time.time(), 4)
    LOG.write(json.dumps(kv) + '\n')
    LOG.flush()


# the shoot's tempo (user, 2026-10-21: "sharper cuts and motion", then "faster ... choppier and faster"): glides, drags and ordinary pauses
# at this fraction of their written length; waits for an app to open (settle) are not scaled
TEMPO = float(os.environ.get('TAHOE_SHOWCASE_TEMPO', '0.75'))


def pause(ms):
    time.sleep(max(120, ms * TEMPO) / 1000)


def settle(ms):
    """wait for something to open or close: not scaled by the tempo"""
    time.sleep(ms / 1000)


def move(x, y, ms=700):
    """a glide that starts at full speed and settles into place (ease-out quart), steered from here
    in 8 ms steps (the installed driver's own glide eases in, which read as the whole frame speeding
    up under the locked camera; GNOME keeps the old driver code until the user logs out)"""
    x, y, ms = int(x), int(y), max(300, int(ms * TEMPO))
    x0, y0 = POS
    log(move=[x0, y0, x, y, ms])
    start = time.monotonic()
    while True:
        t = min(1.0, (time.monotonic() - start) * 1000 / ms)
        e = 1 - (1 - t) ** 4
        call('Move', (round(x0 + (x - x0) * e), round(y0 + (y - y0) * e), 0), '(iiu)')
        if t >= 1:
            break
        time.sleep(0.008)
    POS[:] = [x, y]


def click(x=None, y=None, button=1):
    x, y = (POS if x is None else (int(x), int(y)))
    log(click=[x, y, button])
    call('Click', (x, y, button), '(iiu)')
    POS[:] = [x, y]


def drag(x2, y2, ms=1300):
    """press where the cursor is, glide (eased) to x2, y2, release (the driver waits 150 ms before)"""
    x2, y2, ms = int(x2), int(y2), max(300, int(ms * TEMPO))
    log(drag=[POS[0], POS[1], x2, y2, ms])
    call('Drag', (POS[0], POS[1], x2, y2, ms), '(iiiiu)')
    POS[:] = [x2, y2]


def press(*keys):
    log(keys=list(keys))
    call('Keys', (list(keys),), '(as)')


def type_(text):
    log(type=text)
    call('Type', (text,), '(s)')


def locate(what):
    (b,) = call('Locate', (what,), '(s)', '((iiii))')
    if b[0] < 0:
        raise LookupError(f'not on screen: {what}')
    return b


def center(what):
    x, y, w, h = locate(what)
    return x + w // 2, y + h // 2


def close_all():
    call('CloseAll')
    press('Escape')
    pause(500)


class Clip:
    """GNOME's screencast of the whole screen while the block runs; its start time is logged so the
    pointer log lines up with its frames (the edit fine-tunes the offset against the tracker)"""

    def __init__(self, name):
        self.name = name
        # one take (--one-take): only the 'tour' clip records; each shot inside it is a marked segment
        self.segment = ONE_TAKE and name != 'tour'

    def __enter__(self):
        if self.segment:
            log(segment=self.name, cursor=list(POS))
            return self
        opts = {'framerate': GLib.Variant('i', 60), 'draw-cursor': GLib.Variant('b', True)}
        t0 = time.time()
        ok, self.file = call('Screencast', (os.path.join(OUT, self.name), opts), '(sa{sv})', '(bs)',
                             dest='org.gnome.Shell.Screencast', path='/org/gnome/Shell/Screencast',
                             iface='org.gnome.Shell.Screencast')
        log(clip=self.name, file=self.file, requested=round(t0, 4), cursor=list(POS))
        pause(500)
        return self

    def __exit__(self, *exc):
        if self.segment:
            log(segment_end=self.name)
            return False
        pause(400)
        call('StopScreencast', dest='org.gnome.Shell.Screencast', path='/org/gnome/Shell/Screencast',
             iface='org.gnome.Shell.Screencast', out='(b)')
        log(clip_end=self.name)
        return False


# ---- set up and put back ---------------------------------------------------------------------
STATE = {}


def players():
    names = BUS.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
                          None, None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    return [n for n in names if n.startswith('org.mpris.MediaPlayer2.') and not n.endswith('.showcase')]


def player(name, method):
    BUS.call_sync(name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', method, None, None,
                  Gio.DBusCallFlags.NONE, 5000, None)


def status(name):
    return BUS.call_sync(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                         GLib.Variant('(ss)', ('org.mpris.MediaPlayer2.Player', 'PlaybackStatus')), None,
                         Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]


def seek_real(name, seconds):
    """the user's player playing its current track, at `seconds` in (so it does not end mid-shoot)"""
    uri = os.environ.get('TAHOE_SHOWCASE_TRACK')   # e.g. spotify:track:...: the song the user chose
    if uri:
        BUS.call_sync(name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'OpenUri',
                      GLib.Variant('(s)', (uri,)), None, Gio.DBusCallFlags.NONE, 5000, None)
        settle(2500)
    if status(name) != 'Playing':
        player(name, 'Play')
        settle(800)
    meta = BUS.call_sync(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                         GLib.Variant('(ss)', ('org.mpris.MediaPlayer2.Player', 'Metadata')), None,
                         Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    BUS.call_sync(name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'SetPosition',
                  GLib.Variant('(ox)', (meta['mpris:trackid'], int(seconds * 1e6))), None, Gio.DBusCallFlags.NONE, 5000, None)
    log(real_player=name, title=meta.get('xesam:title'), seek=seconds)


def gset(schema, key, value=None):
    if value is None:
        return subprocess.run(['gsettings', 'get', schema, key], capture_output=True, text=True).stdout.strip()
    subprocess.run(['gsettings', 'set', schema, key, value], check=True)


def reload_widgets():
    subprocess.run(['gnome-extensions', 'disable', WIDGETS_UUID], check=True)
    pause(800)
    subprocess.run(['gnome-extensions', 'enable', WIDGETS_UUID], check=True)
    pause(2500)


def demo_folder():
    """what Files shows: a made-up folder, not the user's home"""
    root = os.path.join(OUT, 'Showcase')
    for d in ('Design', 'Music', 'Photos', 'Projects', 'Wallpapers'):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    for f, text in (('Glass notes.txt', 'Refraction, rim light, edge shadow.\n'),
                    ('Release plan.txt', 'Title, montage, README.\n'), ('Palette.txt', 'Fold, violet, coral.\n')):
        with open(os.path.join(root, f), 'w') as fh:
            fh.write(text)
    return root


def files_windows():
    """how many Files windows are open (Nautilus exports one D-Bus object per window)"""
    try:
        xml = BUS.call_sync('org.gnome.Nautilus', '/org/gnome/Nautilus/window', 'org.freedesktop.DBus.Introspectable',
                            'Introspect', None, GLib.VariantType('(s)'), Gio.DBusCallFlags.NO_AUTO_START, 3000, None).unpack()[0]
    except GLib.Error:
        return 0
    return xml.count('<node name=')


def setup():
    # a Files window would be on camera in every clip (an interrupted run once left one behind)
    if files_windows():
        raise RuntimeError('a Files window is open: close it first (it would be in every clip)')
    shutil.copy2(LAYOUT, os.path.join(OUT, 'widgets.user.json'))
    shutil.copy2(LAYOUT, LAYOUT + '.before-showcase')
    STATE['layout'] = True
    with open(LAYOUT, 'w') as fh:
        json.dump(SHOOT_LAYOUT, fh, indent=2)
    reload_widgets()
    real = os.environ.get('TAHOE_SHOWCASE_PLAYER')
    if real:
        seek_real(f'org.mpris.MediaPlayer2.{real}', float(os.environ.get('TAHOE_SHOWCASE_SEEK', '60')))
    else:
        STATE['playing'] = [n for n in players() if status(n) == 'Playing']
        for n in STATE['playing']:
            player(n, 'Pause')
        song = os.environ.get('TAHOE_SHOWCASE_SONG')
        STATE['fake'] = subprocess.Popen([sys.executable, os.path.join(HERE, 'fakeplayer.py')] + (['--song', song] if song else []),
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    STATE['nautilus'] = (gset('org.gnome.nautilus.window-state', 'maximized'),
                         gset('org.gnome.nautilus.window-state', 'initial-size'))
    gset('org.gnome.nautilus.window-state', 'maximized', 'false')
    gset('org.gnome.nautilus.window-state', 'initial-size', '(1100, 680)')
    STATE['settings'] = gset('org.gnome.Settings', 'window-state')
    gset('org.gnome.Settings', 'window-state', '(1060, 700, false)')
    press('Super_L', 'Page_Down')            # an empty workspace
    STATE['workspace'] = True
    pause(1200)
    move(*HOME_XY, 400)
    pause(1500)                               # the fake player's cover and lyrics settle in


def restore():
    """everything back, each step on its own so one failure does not stop the rest"""
    steps = []
    if STATE.get('mode'):                      # a mode switch cut short: the user's mode back
        steps.append(lambda: subprocess.run(['bash', GLASS_BAR, 'mode', STATE['mode']], check=True))
    if STATE.get('workspace'):
        steps.append(lambda: press('Super_L', 'Page_Up'))
    if STATE.get('fake'):
        steps.append(lambda: (STATE['fake'].terminate(), STATE['fake'].wait(5)))
    for n in STATE.get('playing', []):
        steps.append(lambda n=n: player(n, 'Play'))
    if 'nautilus' in STATE:
        steps.append(lambda: gset('org.gnome.nautilus.window-state', 'maximized', STATE['nautilus'][0]))
        steps.append(lambda: gset('org.gnome.nautilus.window-state', 'initial-size', STATE['nautilus'][1]))
    if 'settings' in STATE:
        steps.append(lambda: gset('org.gnome.Settings', 'window-state', STATE['settings']))
    if STATE.get('layout'):
        steps.append(lambda: shutil.copy2(LAYOUT + '.before-showcase', LAYOUT))
        steps.append(reload_widgets)
    if STATE.get('driver'):
        steps.append(lambda: subprocess.run(['gnome-extensions', 'disable', DRIVER], check=True))
    if STATE.get('driver_copied'):
        steps.append(lambda: shutil.rmtree(STATE['driver_copied']))
    for step in steps:
        try:
            step()
        except Exception as e:  # noqa: BLE001
            print(f'restore: {e}', file=sys.stderr)


# ---- the screenplay (REWRITE.md): one clip per shot, the cursor always going somewhere -------
def widget_box(w, h):
    for i in range(12):
        try:
            b = locate(f'widget:{i}')
        except LookupError:
            break
        if (b[2], b[3]) == (w, h):
            return b
    raise LookupError(f'no {w}x{h} widget')


def s_home():
    """the home screen, still, the cursor resting where the montage begins: the title's joins"""
    with Clip('home'):
        move(*HOME_XY, 300)
        pause(2500)


def s_home_end():
    """the same, after every shot: where the montage ends (the clock and the music have moved on)"""
    with Clip('home-end'):
        move(*HOME_XY, 300)
        pause(2500)


def s_widget_drag():
    """the analog clock picked up from its column and set down beside the Weather widget: top edges
    lined up, the standard 16 px gap between them, on the 8 px grid (user, 2026-10-21: "line up with
    the spacing beside another widget to follow a grid"). It stays there (no drag back); the layout
    is restored after the shoot"""
    x, y, w, h = widget_box(170, 170)          # the analog clock
    wx, wy, ww, wh = widget_at(392, 250)       # Weather: Week, by its place in the shoot layout
    tx, ty = wx + ww + 16 + w // 2, wy + h // 2
    with Clip('widget-drag'):
        move(x + w // 2, y + h // 2, 900)
        pause(300)
        drag(tx, ty, 1500)
        pause(1200)                            # it settles into its place
        log(clock_box=list(locate_widget_near(tx, ty)))
        move(*HOME_XY, 900)


def locate_widget_near(x, y):
    for i in range(20):
        try:
            b = locate(f'widget:{i}')
        except LookupError:
            break
        if b[0] <= x <= b[0] + b[2] and b[1] <= y <= b[1] + b[3]:
            return b
    return (-1, -1, -1, -1)


def qs_arrow():
    for i in range(12):
        try:
            x, y, w, h = locate(f'qs-toggle:{i}')
        except LookupError:
            break
        if w < 300 and h > 60:
            return x + w - 28, y + h // 2
    raise LookupError('no two-part toggle')


def s_quick_settings():
    with Clip('quick-settings'):
        move(1900, 560, 700)
        pause(300)
        move(*center('quick-settings'), 900)
        click()
        pause(900)
        move(*qs_arrow(), 800)
        click()
        pause(1700)
        move(POS[0] - 140, POS[1] + 120, 700)   # over the Wi-Fi list
        pause(900)
        close_all()
        move(*HOME_XY, 900)


def window_header(app):
    x, y, w, h = locate(f'window:{app}')
    return x + w // 2, y + 26


def s_files_window():
    folder = demo_folder()
    with Clip('files-window'):
        move(*center('dock:org.gnome.Nautilus'), 900)
        pause(250)
        subprocess.Popen(['nautilus', '--new-window', folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        settle(1700)
        move(*window_header('org.gnome.Nautilus'), 900)
        pause(200)
        drag(POS[0] + 440, POS[1] - 160, 1400)
        pause(500)
        drag(POS[0] - 700, POS[1] + 120, 1500)
        pause(800)
        press('Control_L', 'w')
        settle(700)
        move(*HOME_XY, 700)


def s_window_menu():
    """the Files window's own menu, from its header bar (the window stays from the last shot)"""
    with Clip('window-menu'):
        hx, hy = window_header('org.gnome.Nautilus')
        move(hx + 60, hy, 600)
        click(button=3)
        pause(900)
        move(POS[0] + 40, POS[1] + 150, 1000)
        pause(1200)
        press('Escape')
        pause(400)
        press('Control_L', 'w')
        pause(900)
        move(*HOME_XY, 900)


def s_menu_slide():
    """the top bar's menus: the calendar opens, then a slow glide right hands it over to quick settings
    (one glass surface morphing), and back. Slower than the rest of the shoot (user, 2026-10-21: "too
    fast where you cant see the animations"): the tempo does not apply here"""
    global TEMPO
    tempo, TEMPO = TEMPO, 1.0
    try:
        with Clip('menu-slide'):
            dx, dy = center('date')
            qx, qy = center('quick-settings')
            move(dx, dy + 300, 500)
            move(dx, dy, 500)
            click()
            pause(1300)                        # the calendar grows out of the clock
            move(qx - 300, qy, 1600)           # across the status icons: each hand-over shows
            pause(700)
            move(qx, qy, 900)
            pause(1500)                        # quick settings, settled
            move(dx, dy, 1800)                 # back: quick settings morphs into the calendar
            pause(1300)
            close_all()
            move(*HOME_XY, 600)
    finally:
        TEMPO = tempo


def widget_boxes():
    out = []
    for i in range(20):
        try:
            out.append(tuple(locate(f'widget:{i}')))
        except LookupError:
            break
    return out


def s_desktop_widget():
    """right-click the wallpaper anywhere: the glass menu; Add Widget expands under its own row; pick
    Analog Clock and the cursor glides to where it appears (user, 2026-10-21). The layout is restored
    after the shoot, so the new widget goes away again"""
    before = set(widget_boxes())
    with Clip('desktop-widget'):
        move(1700, 640, 700)
        click(button=3)
        pause(900)                             # the menu grows out of the click
        move(POS[0] + 70, POS[1] + 22, 500)    # Add Widget, the menu's first row
        click()
        pause(800)                             # the submenu expands under it
        move(POS[0] + 10, POS[1] + 34, 500)    # its first entry: Analog Clock
        pause(300)
        click()
        settle(900)
        new = [b for b in widget_boxes() if b not in before]
        if new:
            x, y, w, h = new[0]
            move(x + w // 2, y + h // 2, 900)  # to the clock that just appeared
            pause(1200)
        log(new_widget=list(new[0]) if new else None)
        move(*HOME_XY, 700)


def s_dock_menu():
    """right-click an app in the dock: its glass menu grows out of the icon; glide over its rows"""
    with Clip('dock-menu'):
        x, y = center('dock:org.gnome.Nautilus')
        move(x, y - 260, 500)
        move(x, y, 700)
        pause(500)                             # the glass name label
        click(button=3)
        pause(900)
        move(x + 20, y - 150, 800)             # up over the menu's rows
        pause(900)
        close_all()
        move(*HOME_XY, 700)


def s_search_click():
    """the overview opens, the cursor glides up to its search bar and clicks it, then types: the
    results pop up on raised glass (user, 2026-10-21: show the cursor going up and clicking it)"""
    with Clip('search-click'):
        move(1280, 700, 500)
        pause(400)
        press('Super_L')
        settle(900)                            # the overview opens
        move(1280, 78, 900)                    # up to the search bar
        pause(300)
        click()
        settle(400)
        type_('calc')
        settle(1600)                           # the results pop up
        press('Escape')
        settle(300)
        press('Escape')
        settle(900)
        move(*HOME_XY, 600)


def s_dock_search():
    """the dock menu straight into the search, one take (user, 2026-10-22: "the right click on the files
    app should transition directly to the app search for the calculator"): Files' glass menu, Escape,
    the overview, the cursor up to the search bar, a click, "calc", the results, back to the desktop"""
    with Clip('dock-search'):
        x, y = center('dock:org.gnome.Nautilus')
        move(x, y - 260, 500)
        move(x, y, 700)
        pause(500)                             # the glass name label
        click(button=3)
        pause(900)
        move(x + 20, y - 150, 800)             # up over the menu's rows
        pause(700)
        press('Escape')                        # the menu shrinks back into the icon
        settle(500)
        press('Super_L')
        settle(900)                            # the overview opens
        move(1280, 78, 900)                    # up to the search bar
        pause(300)
        click()
        settle(400)
        type_('calc')
        settle(1600)                           # the results pop up
        press('Escape')
        settle(300)
        press('Escape')
        settle(900)
        move(*HOME_XY, 600)
        settle(1200)                           # the home screen, still: where the title takes over


def s_files_to_folder():
    """one take (user, 2026-10-22: "the files window is closed then the utilities app is opened naturally
    by actually clicking the buttons"): Files from the dock, a drag, Ctrl+W, the cursor to the dock's
    grid button and a click, up to the Utilities folder and a click, the folder and the grid closed"""
    folder = demo_folder()
    with Clip('files-to-folder'):
        move(*center('dock:org.gnome.Nautilus'), 900)
        pause(250)
        subprocess.Popen(['nautilus', '--new-window', folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        settle(1700)
        move(*window_header('org.gnome.Nautilus'), 900)
        pause(200)
        drag(POS[0] + 440, POS[1] - 160, 1400)
        pause(600)
        press('Control_L', 'w')
        settle(900)                            # the window shrinks away
        move(*center('show-apps'), 1000)       # down to the dock's grid button
        pause(400)
        click()
        settle(1300)                           # the grid opens
        move(*center('folder:0'), 1000)
        pause(300)
        click()
        pause(1800)                            # the folder, open
        press('Escape')
        pause(500)
        press('Escape')
        pause(500)
        press('Escape')
        pause(800)
        move(*HOME_XY, 800)


def s_widget_to_menu():
    """one take (user, 2026-10-22: a seamless join between the clock widget being added and the top
    menu): the desktop's right-click menu, Add Widget, Analog Clock, the cursor glides to the new clock,
    then straight up to the date in the top bar: the calendar, the slow glide into quick settings and
    back, as s_menu_slide (its slower tempo)"""
    global TEMPO
    before = set(widget_boxes())
    with Clip('widget-to-menu'):
        move(1700, 640, 700)
        click(button=3)
        pause(900)                             # the menu grows out of the click
        move(POS[0] + 70, POS[1] + 22, 500)    # Add Widget, the menu's first row
        click()
        pause(800)                             # the submenu expands under it
        move(POS[0] + 10, POS[1] + 34, 500)    # its first entry: Analog Clock
        pause(300)
        click()
        settle(900)
        new = [b for b in widget_boxes() if b not in before]
        if new:
            x, y, w, h = new[0]
            move(x + w // 2, y + h // 2, 900)  # to the clock that just appeared
            pause(1000)
        log(new_widget=list(new[0]) if new else None)
        tempo, TEMPO = TEMPO, 1.0
        try:
            dx, dy = center('date')
            qx, qy = center('quick-settings')
            move(dx, dy, 1100)                 # up to the date
            pause(200)
            click()
            pause(1300)                        # the calendar grows out of the clock
            move(qx - 300, qy, 1600)           # across the status icons: each hand-over shows
            pause(700)
            move(qx, qy, 900)
            pause(1500)                        # quick settings, settled
            move(dx, dy, 1800)                 # back: quick settings morphs into the calendar
            pause(1300)
            close_all()
            move(*HOME_XY, 600)
        finally:
            TEMPO = tempo


def s_overview_search():
    with Clip('overview-search'):
        press('Super_L')
        settle(700)
        type_('calc')
        pause(1400)
        move(POS[0], POS[1] - 240, 900)        # up over the result panels
        pause(1000)
        press('Escape')
        pause(300)
        press('Escape')
        pause(800)
        move(*HOME_XY, 700)


def widget_at(x, y):
    """the widget whose top left corner is at x, y (the shoot layout's positions)"""
    for i in range(12):
        try:
            b = locate(f'widget:{i}')
        except LookupError:
            break
        if abs(b[0] - x) <= 8 and abs(b[1] - y) <= 8:
            return b
    raise LookupError(f'no widget at {x}, {y}')


def s_music():
    mx, my, mw, mh = widget_at(16, 64)          # Music: Large
    with Clip('music'):
        move(mx + mw // 2, my + mh // 3, 1100)   # over the cover: the swirl under the glass
        pause(1500)
        move(mx + mw // 2, my + mh - 50, 800)    # the controls
        pause(1200)
        move(mx + mw // 2, my + mh + 220, 900)   # down to the Lyrics widget: the placeholder lines
        pause(2200)
        move(*HOME_XY, 1100)


def s_calendar():
    with Clip('calendar'):
        move(1280, 420, 700)
        pause(200)
        move(*center('date'), 800)
        click()
        pause(1000)
        move(POS[0] + 160, POS[1] + 420, 1100)  # down over the concentric cards
        pause(1300)
        close_all()
        move(*HOME_XY, 900)


def s_volume():
    with Clip('volume'):
        move(1280, 1180, 800)                   # above the dock, where the OSD appears
        pause(300)
        for k in ('AudioRaiseVolume', 'AudioRaiseVolume', 'AudioLowerVolume', 'AudioLowerVolume'):
            press(k)
            pause(350)
        pause(1500)
        move(*HOME_XY, 800)


def s_desktop_menu():
    with Clip('desktop-menu'):
        move(1760, 760, 800)
        pause(200)
        click(button=3)
        pause(900)
        move(POS[0] + 30, POS[1] + 130, 900)    # down the menu, to Add Widget
        pause(1300)
        close_all()
        move(*HOME_XY, 800)


def s_app_grid():
    with Clip('app-grid'):
        press('Super_L', 'a')                   # the app grid (a second Super can land on the windows)
        settle(1200)
        move(*center('folder:0'), 1000)
        click()
        pause(1800)
        press('Escape')
        pause(500)
        press('Escape')
        pause(500)
        press('Escape')
        pause(800)
        move(*HOME_XY, 800)


def s_settings_window():
    with Clip('settings-window'):
        move(1280, 600, 600)
        subprocess.Popen(['gnome-control-center', 'background'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        settle(2000)
        move(*window_header('org.gnome.Settings'), 900)
        pause(200)
        drag(POS[0] - 380, POS[1] + 140, 1400)
        pause(500)
        drag(POS[0] + 560, POS[1] - 60, 1400)
        pause(800)
        press('Control_L', 'q')
        pause(900)
        # closing the last window here once switched to the user's own workspace: back to the empty
        # one (from the empty last workspace this does nothing)
        press('Super_L', 'Page_Down')
        pause(900)
        move(*HOME_XY, 900)


# ---- the README's feature clips (--features): one short clip per row of the front page ----------
# the four songs the user picked for the music widgets (2026-10-21), played by their own Spotify
# (TAHOE_SHOWCASE_PLAYER=spotify): real covers, real synced lyrics from lrclib.net (user's choice).
# (track, song title, seconds in); the IDs are from each album's open.spotify.com page, checked by title
SONGS = [('spotify:track:4tQcyj5488alHT1ZgFduzn', 'How Much A Dollar Cost', 70),     # To Pimp a Butterfly
         ('spotify:track:35YyxFpE0ZTOoqFx5bADW8', 'Nude', 75),                       # In Rainbows
         ('spotify:track:2lTm559tuIvatlT1u0JYG2', 'BAILE INoLVIDABLE', 60),          # DeBÍ TiRAR MáS FOToS
         ('spotify:track:3k2kIiJqUiIP49iUcOLpWT', 'The Place Where He Inserted the Blade', 60)]  # Ants From Up There
SPOTIFY = 'org.mpris.MediaPlayer2.spotify'


def spotify_meta():
    return BUS.call_sync(SPOTIFY, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                         GLib.Variant('(ss)', ('org.mpris.MediaPlayer2.Player', 'Metadata')), None,
                         Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]


def empty_workspace():
    """the empty last workspace: none of the user's windows on camera"""
    press('Super_L', 'End')
    settle(1000)


def open_uri(uri):
    BUS.call_sync(SPOTIFY, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'OpenUri',
                  GLib.Variant('(s)', (uri,)), None, Gio.DBusCallFlags.NONE, 5000, None)
    settle(1800)


def play_track(uri, seconds):
    open_uri(uri)
    if status(SPOTIFY) != 'Playing':
        player(SPOTIFY, 'Play')
        settle(500)
    meta = spotify_meta()
    BUS.call_sync(SPOTIFY, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'SetPosition',
                  GLib.Variant('(ox)', (meta['mpris:trackid'], int(seconds * 1e6))), None, Gio.DBusCallFlags.NONE, 5000, None)
    log(song=meta.get('xesam:title'), track=uri, art=meta.get('mpris:artUrl'))
    return meta.get('xesam:title')


def s_albums():
    """one clip per song: the cover, the swirl of its colours under the glass, the synced lyrics. Each
    song plays a few seconds first (opening a track raises Spotify: never inside a clip), so lrclib.net's lyrics are cached when the camera rolls"""
    for uri, title, sec in SONGS:
        play_track(uri, sec)
        settle(2500)
    for i, (uri, title, sec) in enumerate(SONGS):
        got = play_track(uri, sec)
        if (got or '').lower() != title.lower():
            raise LookupError(f'{uri} played {got}, not {title}')
        empty_workspace()
        settle(2000)                           # the swirl settles on the new colours
        mx, my, mw, mh = widget_at(16, 64)     # Music: Large
        with Clip(f'song-{i + 1}'):
            move(mx + mw // 2, my + mh // 3, 900)
            pause(1500)
            move(mx + mw // 2, my + mh + 200, 900)   # down to the lyrics
            pause(2500)
            move(*HOME_XY, 900)


def s_live_blur():
    """the Music widget, its swirl always moving, carried under where the calendar opens: the calendar's
    glass blurs what is under it every frame, so the swirl keeps moving through it; then carried back"""
    x, y, w, h = widget_at(16, 64)
    dx, dy = center('date')
    tx = dx - w // 2
    with Clip('live-blur'):
        move(x + w // 2, y + 90, 800)
        pause(200)
        drag(tx + w // 2, y + 90, 1500)
        pause(500)
        move(dx, dy, 700)
        click()
        pause(1200)
        move(dx + 120, dy + 260, 1400)         # over the calendar, the swirl moving under it
        pause(2200)
        close_all()
        move(tx + w // 2, y + 90, 600)
        drag(x + w // 2, y + 90, 1400)
        pause(500)
        move(*HOME_XY, 800)


def s_icons():
    """quick settings: Wi-Fi off and on, its icon redrawn (the slash draws itself across, then the arcs
    light up from the dot: tahoe-motion's iconmorph). Wi-Fi is off for about two seconds"""
    empty_workspace()
    with Clip('icons'):
        move(*center('quick-settings'), 900)
        click()
        pause(900)
        ax, ay = qs_arrow()
        move(ax - 80, ay, 700)                 # the toggle's own half (its icon), not its arrow
        pause(300)
        click()
        pause(2000)
        click()
        pause(2400)
        close_all()
        move(*HOME_XY, 800)


GLASS_BAR = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'scripts', 'glass-bar.sh')


def s_modes():
    """light, milky and back to dark: one command switches the whole desktop"""
    before = gset_mode()
    STATE['mode'] = before
    empty_workspace()
    with Clip('modes'):
        move(1280, 600, 600)
        for mode in ('light', 'milky', before):
            pause(1600)
            subprocess.run(['bash', GLASS_BAR, 'mode', mode], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            settle(900)
            if mode != before:
                move(*center('quick-settings'), 800)
                click()
                pause(1600)
                close_all()
                move(1280, 600, 700)
        pause(800)
    STATE.pop('mode')


def gset_mode():
    with open(os.path.expanduser('~/.config/tahoe-glass/state')) as fh:
        modes = [l.split('=', 1)[1].strip() for l in fh if l.startswith('mode=')]
    return modes[-1] if modes else 'dark'


# in the order of the cut (docs/showcase/montage/edit.json), so each shot starts near where the last left;
# the user's 2026-10-21 notes: the OS's own animations (the top bar menus, the control centre) instead
# of the desktop menu, window menu and volume shots
SHOTS = [s_home, s_widget_drag, s_quick_settings, s_menu_slide, s_files_window, s_settings_window,
         s_overview_search, s_app_grid, s_music, s_home_end, s_desktop_widget, s_dock_menu, s_search_click,
         s_dock_search, s_files_to_folder, s_widget_to_menu]
# the README's rows: live blur, motion, spacing (the calendar), icons, widgets, modes
FEATURE_SHOTS = [s_live_blur, s_files_window, s_menu_slide, s_quick_settings, s_desktop_widget, s_calendar,
                 s_icons, s_dock_menu, s_albums, s_modes]
if '--features' in sys.argv:
    SHOTS = FEATURE_SHOTS


def main():
    global BUS, LOG
    names = ARGS[1:]
    shots = [s for s in SHOTS if not names or s.__name__[2:] in names]
    if DRY:
        print('layout for the shoot:', json.dumps(SHOOT_LAYOUT['widgets']))
        print('current layout:', open(LAYOUT).read().strip())
        print('shots:', ', '.join(s.__name__[2:] for s in shots))
        return
    os.makedirs(OUT, exist_ok=True)
    BUS = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    LOG = open(os.path.join(OUT, 'montage.jsonl'), 'a')
    signal.signal(signal.SIGTERM, lambda *a: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        driver_on()
        setup()
        if ONE_TAKE:
            shots = [s for s in shots if s not in (s_home, s_home_end)]
            with Clip('tour'):
                move(*HOME_XY, 300)
                pause(1600)                   # the home screen, still: where the title hands over
                run_shots(shots)
                move(*HOME_XY, 600)
                settle(1800)                  # and where the lock screen takes over
            return
        run_shots(shots)
    finally:
        restore()
        log(restored=True)


def run_shots(shots):
    for shot in shots:
        try:
            shot()
            log(done=shot.__name__[2:])
        except Exception as e:  # noqa: BLE001  one failed shot never stops the rest
            log(failed=shot.__name__[2:], error=f'{type(e).__name__}: {e}')
            try:
                close_all()
                empty_workspace()
            except GLib.Error:
                pass


DRIVER = 'showcase@local'


def driver_on():
    """the driver is on only for the shoot (it can move the pointer and press keys)"""
    installed = os.path.expanduser(f'~/.local/share/gnome-shell/extensions/{DRIVER}')
    if not os.path.isdir(installed):
        shutil.copytree(os.path.join(os.path.dirname(HERE), 'showcase@local'), installed)
        STATE['driver_copied'] = installed
        pause(1500)                           # the shell notices the new folder
    if 'Enabled: Yes' not in subprocess.run(['gnome-extensions', 'info', DRIVER], capture_output=True, text=True).stdout:
        subprocess.run(['gnome-extensions', 'enable', DRIVER], check=True)
        STATE['driver'] = True
    for _ in range(40):
        try:
            log(driver=call('Ping', out='(s)'), moves='out-quart (stepped here)', drags='driver in-out')
            return
        except GLib.Error:
            pause(500)
    raise RuntimeError('the showcase driver did not come up (a logout may be needed after installing it)')


if __name__ == '__main__':
    main()
