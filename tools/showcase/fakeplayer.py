#!/usr/bin/env python3
"""A pretend music player for the showcase shoots: no song's words or artwork on camera.

  fakeplayer.py [--make-assets]

Owns org.mpris.MediaPlayer2.showcase on the session bus and says it is Playing a local file,
fake-track/showcase.flac. The Music widgets follow the player that is playing, read the lyrics from
the .lrc beside that file (mpris.js findLyrics: a local .lrc is read and lrclib.net is never asked)
and the cover from fake-track/cover.png. The audio file itself does not exist and nothing plays.

The lyrics are the widget showcase's placeholder text (docs/showcase/widgets/PLAN.md), timed one line
every 3 s; the cover is an abstract gradient made here (--make-assets writes both).

Stop it with Ctrl+C or SIGTERM; the name goes with it.
"""
import math
import signal
import sys
import time
from pathlib import Path

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

HERE = Path(__file__).resolve().parent / 'fake-track'
TRACK = HERE / 'showcase.flac'
LRC = HERE / 'showcase.lrc'
COVER = HERE / 'cover.png'
LENGTH_S = 214
START_S = 6.0           # where the song is when the player starts: mid-line, the wave already moving

LINES = [
    'Placeholder lyrics, written for this demo',
    'Not the words of the song on the card',
    'Each line drifts up when its time comes',
    'The sung line grows, the others fade back',
    'A wave runs down the column, line by line',
    'The glass takes its colours from the cover',
    'Slow ribbons turning under the text',
    'Timed in a file that sits beside the track',
    'Nothing here was fetched from the web',
    'Back to the top, and round again',
]

XML = """
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/><method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/><property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/><property name="Identity" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/><property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/><method name="Previous"/><method name="Pause"/><method name="PlayPause"/>
    <method name="Stop"/><method name="Play"/>
    <method name="Seek"><arg type="x" direction="in"/></method>
    <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
    <signal name="Seeked"><arg type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/><property name="Rate" type="d" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/><property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/><property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/><property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/><property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/><property name="CanControl" type="b" access="read"/>
  </interface>
</node>"""


def make_assets():
    """the .lrc (a line every 3 s, looping over the track) and an abstract 600 px cover"""
    HERE.mkdir(exist_ok=True)
    out, t, i = [], 0.0, 0
    while t < LENGTH_S:
        out.append(f'[{int(t // 60):02d}:{t % 60:05.2f}]{LINES[i % len(LINES)]}')
        t += 3.0
        i += 1
    LRC.write_text('\n'.join(out) + '\n')
    from PIL import Image, ImageFilter
    import numpy as np
    n = 600
    y, x = np.mgrid[0:n, 0:n] / n
    # three soft colour fields (violet, magenta, deep blue) and a light ribbon: nobody's artwork
    def blob(cx, cy, r):
        return np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r))[..., None]
    img = (np.array([40, 22, 70]) + blob(0.25, 0.3, 0.28) * np.array([170, 60, 200])
           + blob(0.8, 0.65, 0.3) * np.array([230, 70, 120]) + blob(0.45, 0.95, 0.25) * np.array([40, 60, 200]))
    ribbon = np.exp(-((y - 0.55 - 0.12 * np.sin(x * math.tau * 1.2)) ** 2) / 0.002)[..., None]
    img = np.clip(img + ribbon * np.array([255, 220, 240]) * 0.55, 0, 255).astype('uint8')
    Image.fromarray(img).filter(ImageFilter.GaussianBlur(3)).save(COVER)
    print(LRC, COVER)


class Player:
    def __init__(self):
        self.started = time.monotonic() - START_S
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        info = Gio.DBusNodeInfo.new_for_xml(XML)
        for iface in info.interfaces:
            self.bus.register_object('/org/mpris/MediaPlayer2', iface, self.method, self.get, None)
        Gio.bus_own_name_on_connection(self.bus, 'org.mpris.MediaPlayer2.showcase', Gio.BusNameOwnerFlags.NONE, None, None)

    def position_us(self):
        return int(((time.monotonic() - self.started) % LENGTH_S) * 1e6)

    def metadata(self):
        return {
            'mpris:trackid': GLib.Variant('o', '/org/showcase/track/1'),
            'mpris:length': GLib.Variant('x', LENGTH_S * 1_000_000),
            'mpris:artUrl': GLib.Variant('s', COVER.as_uri()),
            'xesam:url': GLib.Variant('s', TRACK.as_uri()),
            'xesam:title': GLib.Variant('s', 'Amorphous'),
            'xesam:artist': GLib.Variant('as', ['Liquid Glass']),
            'xesam:album': GLib.Variant('s', 'Showcase'),
        }

    def get(self, conn, sender, path, iface, prop):
        values = {
            'CanQuit': GLib.Variant('b', False), 'CanRaise': GLib.Variant('b', False),
            'HasTrackList': GLib.Variant('b', False), 'Identity': GLib.Variant('s', 'Showcase'),
            'SupportedUriSchemes': GLib.Variant('as', ['file']), 'SupportedMimeTypes': GLib.Variant('as', []),
            'PlaybackStatus': GLib.Variant('s', 'Playing'), 'Rate': GLib.Variant('d', 1.0),
            'Metadata': GLib.Variant('a{sv}', self.metadata()), 'Volume': GLib.Variant('d', 1.0),
            'Position': GLib.Variant('x', self.position_us()),
            'MinimumRate': GLib.Variant('d', 1.0), 'MaximumRate': GLib.Variant('d', 1.0),
            'CanGoNext': GLib.Variant('b', True), 'CanGoPrevious': GLib.Variant('b', True),
            'CanPlay': GLib.Variant('b', True), 'CanPause': GLib.Variant('b', True),
            'CanSeek': GLib.Variant('b', False), 'CanControl': GLib.Variant('b', True),
        }
        return values.get(prop)

    def method(self, conn, sender, path, iface, name, params, invocation):
        invocation.return_value(None)   # the buttons may be pressed on camera: it keeps playing


def main():
    if '--make-assets' in sys.argv:
        make_assets()
        return
    if not LRC.exists() or not COVER.exists():
        make_assets()
    Player()
    loop = GLib.MainLoop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, loop.quit)
    print('org.mpris.MediaPlayer2.showcase: playing (Ctrl+C to stop)', flush=True)
    loop.run()


if __name__ == '__main__':
    main()
