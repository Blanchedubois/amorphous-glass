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
    pause(500)


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
        ax, ay = center('qs-arrow:0')
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
def s_files():
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


@shot_fn
def s_overview():
    with Clip('overview'):
        press('Super_L')
        pause(1300)
        shot('overview')
        type_('set')
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
    x, y, w, h = locate('widget:0')
    with Clip('widget-drag'):
        call('Drag', (x + w // 2, y + 30, x + w // 2 + 240, y + 150, 1200), '(iiiiu)')
        pause(900)
        call('Drag', (x + w // 2 + 240, y + 150, x + w // 2, y + 30, 1200), '(iiiiu)')
        pause(900)


def main():
    if '--list' in sys.argv:
        print('\n'.join(SHOTS))
        return
    log(driver=wait_driver())
    names = [a for a in sys.argv[2:] if not a.startswith('-')] or list(SHOTS)
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
