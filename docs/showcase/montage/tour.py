#!/usr/bin/env python3
"""The montage as one take: the whole tour of the desktop, unbroken, through a camera that zooms in and
follows the cursor where there is detail and pulls back to the whole screen where there is not.

  tour.py TOUR.mp4 TRACK.json MONTAGE.jsonl -o OUT.mp4 [--lock LOCK.mp4 --lock-in S --lock-out S]
          [--draft]

TOUR.mp4: the one-take recording (tools/showcase/montage_shoot.py --one-take); TRACK.json: its cursor
path (pointer.py); MONTAGE.jsonl: the shoot's log, whose segment marks say which part of the tour
is playing. User, 2026-10-21: "take the entire clip of moving around the OS ... all in one take but
instead zoom in and follow the mouse when needed ... splice the lock screen closing and opening
animation in".

The camera: the zoom of each segment (ZOOM below; 1 is the whole screen), eased between segments on
a critically damped spring (no overshoot), and the view centred on the cursor on a softer spring, so
it trails a quick move a little and never jitters; the view always stays inside the screen. After
the tour (it ends on the home screen, whole) the lock screen recording is spliced in, full screen:
Super+L's lock, the clock with the music, the sign-in and the unlock; a short dissolve each side.
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT_W, OUT_H, FPS = 1920, 1080, 60

# per segment: how close the camera comes (the screen is 2560 wide: 1.6 shows 1600 px of it)
ZOOM = {
    'rest': 1.0,                 # the home screen at the start and the end: the title's plates
    'widget-drag': 1.45,
    'quick-settings': 1.6,
    'menu-slide': 1.35,
    'files-window': 1.2,
    'settings-window': 1.2,
    'overview-search': 1.0,      # the overview and its results fill the screen: the whole of it
    'app-grid': 1.0,
    'music': 1.6,
}
CENTRE = {'damping': 1.0, 'stiffness': 30.0}
ZOOMING = {'damping': 1.0, 'stiffness': 9.0}
LEAD = 0.35                       # s: the zoom heads for a segment's level this early


class Spring:
    def __init__(self, value, token):
        self.value, self.target, self.velocity = value, value, 0.0
        self.w = math.sqrt(token['stiffness'])

    def step(self, dt):   # critically damped
        w, u0, v0 = self.w, self.value - self.target, self.velocity
        d, b = math.exp(-w * dt), v0 + w * u0
        self.value = self.target + (u0 + b * dt) * d
        self.velocity = (v0 - w * b * dt) * d
        return self.value


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout.split(',')
    return int(out[0]), int(out[1])


def frames(path, start=0.0, length=None):
    w, h = probe(path)
    cmd = ['ffmpeg', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', str(path)]
    if length:
        cmd += ['-t', f'{length:.3f}']
    proc = subprocess.Popen(cmd + ['-vf', f'fps={FPS}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    while True:
        buf = proc.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        yield Image.frombuffer('RGB', (w, h), buf, 'raw', 'RGB', 0, 1)
    proc.wait()


def segments(log_path, offset):
    """[(start s, end s, name)] in the video's time, from the log's segment marks"""
    log = [json.loads(l) for l in Path(log_path).read_text().splitlines() if l.strip()]
    clip = [e for e in log if e.get('clip') == 'tour'][-1]
    t0 = clip['requested'] + offset
    out, cur = [], None
    for e in log[log.index(clip):]:
        if 'segment' in e:
            cur = (e['t'] - t0, e['segment'])
        elif 'segment_end' in e and cur:
            out.append((cur[0], e['t'] - t0, cur[1]))
            cur = None
        elif 'clip_end' in e:
            break
    return out


def zoom_at(t, segs):
    for a, b, name in segs:
        if a - LEAD <= t < b - LEAD:
            return ZOOM.get(name, 1.3)
    return ZOOM['rest']


def view(im, cx, cy, z, out_size):
    w, h = im.size
    vw, vh = w / z, w / z * OUT_H / OUT_W
    x0 = min(max(cx - vw / 2, 0), w - vw)
    y0 = min(max(cy - vh / 2, 0), h - vh)
    return im.resize(out_size, Image.LANCZOS, box=(x0, y0, x0 + vw, y0 + vh))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('tour')
    ap.add_argument('track')
    ap.add_argument('log')
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--lock')
    ap.add_argument('--lock-in', type=float, default=1.0)
    ap.add_argument('--lock-out', type=float, default=9.6)
    ap.add_argument('--start', type=float, default=0.0, help='where in the tour to begin (s)')
    ap.add_argument('--draft', action='store_true')
    args = ap.parse_args()
    out_size = (OUT_W // 2, OUT_H // 2) if args.draft else (OUT_W, OUT_H)
    track = json.loads(Path(args.track).read_text())
    pts = np.array([[p[0], p[1]] for p in track['points']], dtype=float)
    segs = segments(args.log, track.get('offset', 0.0))
    for a, b, n in segs:
        print(f'  {a:6.2f} - {b:6.2f}  {n}  zoom {ZOOM.get(n, 1.3)}', file=sys.stderr)
    enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{out_size[0]}x{out_size[1]}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264',
                            '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', args.output], stdin=subprocess.PIPE)
    dt = 1 / FPS
    first = pts[min(len(pts) - 1, int(args.start * FPS))]
    cx, cy, z = Spring(first[0], CENTRE), Spring(first[1], CENTRE), Spring(zoom_at(args.start, segs), ZOOMING)
    last = None
    for n, im in enumerate(frames(args.tour, args.start)):
        t = args.start + n * dt
        p = pts[min(len(pts) - 1, round(t * FPS))]
        cx.target, cy.target, z.target = p[0], p[1], zoom_at(t, segs)
        for s in (cx, cy, z):
            s.step(dt)
        last = np.asarray(view(im, cx.value, cy.value, max(1.0, z.value), out_size))
        enc.stdin.write(last.tobytes())
    tour_frames = n + 1
    if args.lock:
        # the lock screen, full screen, a dissolve in and out (it ends where it began: the home screen)
        lock = [np.asarray(im.resize(out_size, Image.LANCZOS))
                for im in frames(args.lock, args.lock_in, args.lock_out - args.lock_in)]
        D = 12
        for i in range(D):
            a = (i + 1) / (D + 1)
            enc.stdin.write((last * (1 - a) + lock[0] * a).astype(np.uint8).tobytes())
        for f in lock:
            enc.stdin.write(f.tobytes())
        for i in range(D):
            a = (i + 1) / (D + 1)
            enc.stdin.write((lock[-1] * (1 - a) + last * a).astype(np.uint8).tobytes())
        for _ in range(30):
            enc.stdin.write(last.tobytes())
    enc.stdin.close()
    enc.wait()
    print(f'{args.output}: tour {tour_frames / FPS:.1f} s', file=sys.stderr)


if __name__ == '__main__':
    main()
