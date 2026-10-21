#!/usr/bin/env python3
"""shoot.py OUTDIR [SHOT..]: the README shoot (docs/SHOWCASE_PLAN.md), driven through the showcase
driver extension (tools/showcase@local) on the session bus. Stills are lossless PNGs from the shell;
clips are GNOME's own screencast (MP4, 2560x1440). With no SHOT names it runs every shot in order.

  python3 tools/showcase/shoot.py OUT --list         the shot names
  TAHOE_SHOWCASE_NO_VIDEO=1                          stills only (the headless test shell has no screencast)

It never locks the screen and never types a password: the lock screen shots are yours (it prompts).
"""
import json, os, subprocess, sys, time

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit(__doc__)
os.makedirs(OUT, exist_ok=True)
BUS = Gio.bus_get_sync(Gio.BusType.SESSION, None)
NO_VIDEO = os.environ.get('TAHOE_SHOWCASE_NO_VIDEO') == '1'
LOG = open(os.path.join(OUT, 'shoot.jsonl'), 'a')


def call(method, args=None, sig=None, out=None, dest='org.cachyos.TahoeShowcase', path='/org/cachyos/TahoeShowcase',
         iface='org.cachyos.TahoeShowcase', timeout=30000):
    v = GLib.Variant(sig, args) if sig else None
    r = BUS.call_sync(dest, path, iface, method, v, GLib.VariantType(out) if out else None,
                      Gio.DBusCallFlags.NONE, timeout, None)
    return r.unpack() if r else None


def wait_driver(seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        try:
            return call('Ping', out='(s)')
        except GLib.Error:
            time.sleep(1)
    sys.exit('the showcase driver is not on the session bus (gnome-extensions enable showcase@local, after a logout)')


def log(**kv):
    kv['t'] = round(time.time(), 3)
    LOG.write(json.dumps(kv) + '\n')
    LOG.flush()
    print(json.dumps(kv), flush=True)


def pause(ms):
    time.sleep(ms / 1000)


def locate(what):
    (b,) = call('Locate', (what,), '(s)', '((iiii))')
    if b[0] < 0:
        raise LookupError(f'not on screen: {what}')
    return b


def center(what):
    x, y, w, h = locate(what)
    return x + w // 2, y + h // 2


def move(x, y, ms=450):
    call('Move', (x, y, ms), '(iiu)')


def click(x, y, button=1):
    call('Click', (x, y, button), '(iiu)')


def press(*keys):
    call('Keys', (list(keys),), '(as)')


def type_(text):
    call('Type', (text,), '(s)')


def shot(name):
    p = os.path.join(OUT, f'{name}.png')
    call('Shot', (p,), '(s)')
    log(still=name)


def close_all():
    call('CloseAll')
    press('Escape')     # menus outside the panel's manager (the desktop menu, the dock menus)
    pause(500)


def qs_arrow():
    """the submenu arrow of the first two-part toggle (Wi-Fi): its right end"""
    for i in range(12):
        try:
            x, y, w, h = locate(f'qs-toggle:{i}')
        except LookupError:
            break
        if w < 300 and h > 60:      # the half-width toggles; the first is Wi-Fi
            return x + w - 28, y + h // 2
    raise LookupError('no two-part toggle')


class Clip:
    """GNOME's screencast of the whole screen while the block runs."""

    def __init__(self, name, fps=60):
        self.name, self.fps = name, fps

    def __enter__(self):
        if NO_VIDEO:
            return self
        opts = {'framerate': GLib.Variant('i', self.fps), 'draw-cursor': GLib.Variant('b', True)}
        self.path = os.path.join(OUT, f'{self.name}.mp4')
        ok, self.file = call('Screencast', (os.path.join(OUT, self.name), opts), '(sa{sv})', '(bs)',
                             dest='org.gnome.Shell.Screencast', path='/org/gnome/Shell/Screencast',
                             iface='org.gnome.Shell.Screencast')
        pause(400)
        return self

    def __exit__(self, *exc):
        if not NO_VIDEO:
            pause(300)
            call('StopScreencast', dest='org.gnome.Shell.Screencast', path='/org/gnome/Shell/Screencast',
                 iface='org.gnome.Shell.Screencast', out='(b)')
            log(clip=self.name, file=self.file)
        return False


def launch(desktop_id, settle=1500):
    env = dict(os.environ)
    if os.environ.get('TAHOE_TEST_DISPLAY'):
        env['WAYLAND_DISPLAY'] = os.environ['TAHOE_TEST_DISPLAY']
    subprocess.Popen(['gtk-launch', desktop_id], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pause(settle)


# ---- the shots: each one function, run in this order ---------------------------------------------
SHOTS = {}


def shot_fn(fn):
    SHOTS[fn.__name__.removeprefix('s_')] = fn
    return fn


@shot_fn
def s_workspace():
    """an empty workspace, so no open window is on camera"""
    press('Super_L', 'Page_Down')
    pause(1200)


@shot_fn
def s_desktop():
    close_all()
    move(1280, 900, 300)
    shot('desktop')


@shot_fn
def s_quick_settings():
    x, y = center('quick-settings')
    with Clip('quick-settings-open'):
        move(x, y, 500)
        click(x, y)
        pause(1200)
        shot('quick-settings')
        ax, ay = qs_arrow()
        move(ax, ay, 400)
        click(ax, ay)
        pause(1200)
        shot('quick-settings-submenu')
        click(ax, ay)
        pause(700)
        click(x, y)
        pause(900)


@shot_fn
def s_calendar():
    x, y = center('date')
    call('Notify', ('Liquid Glass', 'Notifications sit on the same glass as the calendar.'), '(ss)')
    pause(600)
    with Clip('calendar-open'):
        move(x, y, 500)
        click(x, y)
        pause(1300)
        shot('calendar')
        click(x, y)
        pause(800)


@shot_fn
def s_menu_slide():
    """open the calendar, then glide across the top bar so each menu hands over to the next"""
    x, y = center('date')
    qx, qy = center('quick-settings')
    with Clip('menu-slide'):
        move(x, y, 400)
        click(x, y)
        pause(900)
        move(qx - 260, qy, 900)
        pause(500)
        move(qx, qy, 700)
        pause(900)
        move(x, y, 900)
        pause(700)
        close_all()


@shot_fn
def s_desktop_menu():
    with Clip('desktop-menu'):
        move(1100, 820, 400)
        click(1100, 820, 3)
        pause(1100)
        shot('desktop-menu')
        close_all()


@shot_fn
def s_dock_menu():
    x, y = center('dock:org.gnome.Nautilus')
    with Clip('dock-menu'):
        move(x, y, 500)
        pause(700)          # the glass name label
        shot('dock-label')
        click(x, y, 3)
        pause(1100)
        shot('dock-menu')
        close_all()


@shot_fn
def s_music():
    """the Music widgets with the album-colour swirl and the synced lyrics (Nude, In Rainbows)"""
    close_all()
    move(1280, 1000, 300)
    shot('music')
    with Clip('music-swirl'):
        pause(14000)


@shot_fn
def s_files():
    folder = os.environ.get('TAHOE_SHOWCASE_FILES')
    if folder:
        env = dict(os.environ)
        if os.environ.get('TAHOE_TEST_DISPLAY'):
            env['WAYLAND_DISPLAY'] = os.environ['TAHOE_TEST_DISPLAY']
        subprocess.Popen(['nautilus', '--new-window', folder], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pause(2500)
    else:
        launch('org.gnome.Nautilus', 2500)
    x, y, w, h = locate('window:org.gnome.Nautilus')
    with Clip('files-menu'):
        shot('files')
        move(x + w // 2, y + h // 2, 500)
        click(x + w // 2, y + h // 2, 3)
        pause(1000)
        shot('files-context-menu')
        press('Escape')
        pause(600)
        press('Control_L', 'w')
        pause(800)


@shot_fn
def s_overview():
    with Clip('overview'):
        press('Super_L')
        pause(1300)
        shot('overview')
        type_(os.environ.get('TAHOE_SHOWCASE_QUERY', 'calc'))
        pause(1300)
        shot('search')
        press('Escape')
        pause(500)
        press('Escape')
        pause(900)


@shot_fn
def s_app_grid():
    with Clip('app-grid'):
        press('Super_L', 'a')
        pause(1500)
        shot('app-grid')
        x, y = center('folder:0')
        move(x, y, 500)
        click(x, y)
        pause(1300)
        shot('app-folder')
        press('Escape')
        pause(700)
        press('Escape')
        pause(500)
        press('Escape')
        pause(900)


@shot_fn
def s_widget_drag():
    """the analog clock dragged next to the Schedule widget, a gap from its edge, top edges lined up
    (the widgets snap to an 8 px grid), held, then back where it was"""
    want = int(os.environ.get('TAHOE_SHOWCASE_DRAG_X', '2000'))
    boxes = []
    for i in range(12):
        try:
            boxes.append(locate(f'widget:{i}'))
        except LookupError:
            break
    x, y, w, h = min(boxes, key=lambda b: abs(b[0] - want))
    dx, dy = (int(v) for v in os.environ.get('TAHOE_SHOWCASE_DRAG_BY', '0,368').split(','))
    gx, gy = x + w // 2, y + h // 2
    with Clip('widget-drag'):
        move(gx, gy, 500)
        pause(300)
        call('Drag', (gx, gy, gx + dx, gy + dy, 1600), '(iiiiu)')
        pause(1500)
        shot('widget-snapped')
        call('Drag', (gx + dx, gy + dy, gx, gy, 1400), '(iiiiu)')
        pause(1000)


MAIN = os.environ.get('TAHOE_SHOWCASE_LIVE', os.path.expanduser('~/Projects/liquid-glass'))
SPOTIFY = ('org.mpris.MediaPlayer2.spotify', '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player')


@shot_fn
def s_nude():
    """Nude from about 50 s in, so the lyrics are mid-verse while the music shots run"""
    dest, path, iface = SPOTIFY
    meta = BUS.call_sync(dest, path, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', (iface, 'Metadata')),
                         None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    track = meta.get('mpris:trackid')
    BUS.call_sync(dest, path, iface, 'SetPosition', GLib.Variant('(ox)', (track, 48_000_000)), None, Gio.DBusCallFlags.NONE, 5000, None)
    BUS.call_sync(dest, path, iface, 'Play', None, None, Gio.DBusCallFlags.NONE, 5000, None)
    pause(2500)


@shot_fn
def s_window_open():
    """a window opening (tahoe-motion), then the window menu from its header bar"""
    with Clip('window-open'):
        launch('org.gnome.Calculator', 1800)
        shot('calculator')
        x, y, w, h = locate('window:org.gnome.Calculator')
        move(x + w // 2, y + 22, 500)
        click(x + w // 2, y + 22, 3)
        pause(1100)
        shot('window-menu')
        press('Escape')
        pause(500)
        press('Control_L', 'q')
        pause(1200)


@shot_fn
def s_osd():
    with Clip('volume-osd'):
        press('AudioRaiseVolume')
        pause(400)
        press('AudioLowerVolume')
        pause(1200)
        shot('volume-osd')
        pause(1500)


@shot_fn
def s_light_mode():
    """Tahoe light: the same glass with dark text; stills, then back to the mode it was in"""
    mode = subprocess.run(['sed', '-n', 's/^mode=//p', os.path.expanduser('~/.config/tahoe-glass/state')],
                          capture_output=True, text=True).stdout.split()[-1:] or ['dark']
    subprocess.run(['bash', f'{MAIN}/scripts/glass-bar.sh', 'mode', 'light'], capture_output=True)
    try:
        pause(2500)
        close_all()
        shot('light-desktop')
        x, y = center('quick-settings')
        click(x, y)
        pause(1300)
        shot('light-quick-settings')
        close_all()
        x, y = center('date')
        click(x, y)
        pause(1300)
        shot('light-calendar')
        close_all()
        folder = os.environ.get('TAHOE_SHOWCASE_FILES')
        if folder:
            subprocess.Popen(['nautilus', '--new-window', folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pause(2500)
            shot('light-files')
            press('Control_L', 'w')
            pause(800)
    finally:
        subprocess.run(['bash', f'{MAIN}/scripts/glass-bar.sh', 'mode', mode[0]], capture_output=True)
        pause(2500)


@shot_fn
def s_claude_back():
    """back to the first workspace, the Claude window restored from the dock"""
    press('Super_L', 'Page_Up')
    pause(1200)
    x, y = center('dock:com.anthropic.Claude')
    move(x, y, 400)
    click(x, y)
    pause(1200)


@shot_fn
def s_lock():
    """the lock screen: the glass clock and the album-colour swirl. GNOME stops screencasts when the
    screen locks, so the driver takes frames instead (it stays on the lock screen, screenshots only).
    Locks through the screensaver interface (the driver never presses Super+L) and leaves the screen
    locked: you unlock it with your password."""
    import threading
    frames = os.path.join(OUT, 'lock-frames')
    os.makedirs(frames, exist_ok=True)
    count, interval = int(os.environ.get('TAHOE_SHOWCASE_LOCK_FRAMES', '160')), 125
    result = {}
    t = threading.Thread(target=lambda: result.update(n=call('Frames', (frames, count, interval), '(suu)', '(u)',
                                                             timeout=count * interval + 120000)))
    t.start()
    pause(1500)
    subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.gnome.ScreenSaver', '--object-path', '/org/gnome/ScreenSaver',
                    '--method', 'org.gnome.ScreenSaver.Lock'], capture_output=True)
    t.join()
    log(lock_frames=result.get('n'), dir=frames)


SWEEP = ['nude', 'workspace', 'desktop', 'music', 'quick_settings', 'calendar', 'menu_slide', 'desktop_menu',
         'dock_menu', 'window_open', 'files', 'overview', 'app_grid', 'osd', 'widget_drag', 'light_mode',
         'claude_back', 'lock']


def main():
    if '--list' in sys.argv:
        print('\n'.join(SHOTS))
        return
    log(driver=wait_driver())
    names = [a for a in sys.argv[2:] if not a.startswith('-')] or (SWEEP if '--sweep' in sys.argv else list(SHOTS))
    for name in names:
        try:
            SHOTS[name]()
            log(done=name)
        except Exception as e:  # noqa: BLE001  one failed shot never stops the rest
            log(failed=name, error=f'{type(e).__name__}: {e}')
            try:
                close_all()
            except GLib.Error:
                pass


if __name__ == '__main__':
    main()
