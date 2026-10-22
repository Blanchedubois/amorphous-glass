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
    ap.add_argument('--lock-mask', type=lambda v: [int(x) for x in v.split(',')], default=[2450, 160, 115, 46],
                    help='x,y,w,h painted out of every lock frame (the stray top bar glass)')
    ap.add_argument('--start', type=float, default=0.0, help='where in the tour to begin (s)')
    ap.add_argument('--cuts', type=Path, help='a cut list (tour-cuts.json): clips of the take, each at one zoom')
    ap.add_argument('--draft', action='store_true')
    args = ap.parse_args()
    out_size = (OUT_W // 2, OUT_H // 2) if args.draft else (OUT_W, OUT_H)
    track = json.loads(Path(args.track).read_text())
    pts = np.array([[p[0], p[1]] for p in track['points']], dtype=float)
    track_fps = track.get('fps', FPS)
    segs = segments(args.log, track.get('offset', 0.0))
    for a, b, n in segs:
        print(f'  {a:6.2f} - {b:6.2f}  {n}  zoom {ZOOM.get(n, 1.3)}', file=sys.stderr)
    enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{out_size[0]}x{out_size[1]}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264',
                            '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', args.output], stdin=subprocess.PIPE)
    dt = 1 / FPS
    if args.cuts:
        last, tour_frames = render_cuts(args, pts, enc, out_size)
        finish(args, enc, last, out_size, tour_frames)
        return
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
    finish(args, enc, last, out_size, tour_frames)


def blur_mix(frm, to, x, out_size):
    """one frame of the blur transition at x (0..1): each side blurred toward the midpoint"""
    from PIL import ImageFilter
    p = x * x * (3 - 2 * x)
    r = 28 * out_size[0] / 1920
    blur = lambda a, k: np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(k))) if k > 0.4 else a
    a = blur(frm, r * p).astype(np.float32)
    b = blur(to, r * (1 - p)).astype(np.float32)
    return (a * (1 - p) + b * p).round().astype(np.uint8)


def render_cuts(args, pts, enc, out_size):
    """each clip of the cut list at its own zoom. Above 1 the cursor is locked to the exact centre of the
    frame (user, 2026-10-21: "I also like the mouse being centered"), the wallpaper continuing past the
    screen's edge, with motion blur along the camera's path. A clip may open with a push-in ("from_zoom",
    over "push" s: from the whole screen onto the cursor) or close with a pull-out ("to_zoom", over
    "pull" s): transitions inside the clip, eased, the camera's centre gliding between the screen's
    middle and the cursor with the zoom. "hold" keeps the camera still on one point instead"""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import edit
    clips = json.loads(args.cuts.read_text())['clips']
    dt, total, last, prev = 1 / FPS, 0, None, None
    size = probe(args.tour)
    W, H = size
    stage = edit.Stage(size, 1.0)        # padded for the widest view any clip uses
    ease = lambda x: x * x * (3 - 2 * x)
    tracks = {}
    for c in clips:
        z_clip = c['zoom']
        count = round((c['out'] - c['in']) * FPS)
        # a clip may come from another recording ("source", with its own "track"): the takes added later
        source = Path(c['source']).expanduser() if 'source' in c else Path(args.tour)
        if 'track' in c:
            key = str(Path(c['track']).expanduser())
            if key not in tracks:
                tracks[key] = np.array([[p[0], p[1]] for p in json.loads(Path(key).read_text())['points']], dtype=float)
            cpts = tracks[key]
        else:
            cpts = pts
        n = 0
        for n, im in enumerate(frames(source, c['in'], c['out'] - c['in'] + 0.1)):
            if n >= count:
                break
            # a lock screen take as a clip of its own (placed anywhere, not only at the end): its stray
            # top bar pill painted out, as --lock does
            if c.get('unpill'):
                im = unpill(im, args.lock_mask)
            t_in, t_out = n * dt, (count - 1 - n) * dt
            z = z_clip
            if 'from_zoom' in c and t_in < c.get('push', 0.8):
                z = c['from_zoom'] + (z_clip - c['from_zoom']) * ease(t_in / c.get('push', 0.8))
            if 'to_zoom' in c and t_out < c.get('pull', 0.8):
                z = c['to_zoom'] + (z_clip - c['to_zoom']) * ease(t_out / c.get('pull', 0.8))
            t = c['in'] + n * dt
            if z <= 1.0001 and z_clip <= 1.0001:
                last = np.asarray(im.resize(out_size, Image.LANCZOS))
            else:
                # how much the camera is on the cursor: 0 at the whole screen, 1 at the clip's zoom
                w = 1.0 if z_clip <= 1 else min(1.0, max(0.0, (z - 1) / (z_clip - 1)))
                mid = np.array([W / 2, H / 2])
                here = mid + w * (edit.position(cpts, t) - mid)
                before = mid + w * (edit.position(cpts, t - edit.SHUTTER * dt) - mid)
                # "hold": [x, y] in the recording: the camera stays still there and the cursor moves
                # in the frame (user, 2026-10-22: the cover's tilt is hard to see while it follows)
                if 'hold' in c:
                    here = before = np.array(c['hold'], dtype=float)
                moved = float(np.hypot(*(here - before)))
                samples = 1 if args.draft or moved < 0.75 or moved > edit.JUMP else int(min(edit.MAX_SAMPLES, max(3, moved / 4)))
                centres = [tuple(before + (here - before) * k / max(1, samples - 1)) for k in range(samples)]
                stage.view = (W / z, W / z * OUT_H / OUT_W)
                last = stage.shoot(stage.compose(im), centres, out_size)
            # "blur_in": N frames: from the previous clip's last frame, through a blur, into this one
            # (the screensaver's entry and exit; the lock uses the same blend in finish())
            if prev is not None and n < c.get('blur_in', 0):
                enc.stdin.write(blur_mix(prev, last, (n + 1) / (c['blur_in'] + 1), out_size).tobytes())
            else:
                enc.stdin.write(last.tobytes())
        prev = last
        total += count
        print(f'  {c["name"]}: {c["in"]:.2f}-{c["out"]:.2f} at {z_clip}', file=sys.stderr)
    return last, total


def unpill(im, box):
    """paint out a box of the lock recording (the throwaway shell's top bar glass, a stray pill at the
    top right): each column is filled with a straight blend from the row above the box to the row
    below it, which on the lock screen's soft background is invisible"""
    if not box:
        return im
    x, y, w, h = box
    a = np.asarray(im).astype(np.float32).copy()
    top, bottom = a[y - 1, x:x + w], a[y + h, x:x + w]
    t = np.linspace(0, 1, h + 2)[1:-1, None, None]
    a[y:y + h, x:x + w] = top[None] * (1 - t) + bottom[None] * t
    return Image.fromarray(a.round().astype(np.uint8))


def finish(args, enc, last, out_size, tour_frames):
    if args.lock:
        # the lock screen, full screen, a dissolve in and out (it ends where it began: the home screen)
        lock = [np.asarray(unpill(im, args.lock_mask).resize(out_size, Image.LANCZOS))
                for im in frames(args.lock, args.lock_in, args.lock_out - args.lock_in)]
        # user, 2026-10-21: "the transition between the lock screen and the main OS should be a blur":
        # the home screen blurs away as the lock comes into focus over it, and back after the
        # sign-in (both blurred at the midpoint, so the swap never shows a hard edge)
        from PIL import ImageFilter
        D = 30
        MAXR = 28 * out_size[0] / 1920
        def blurred(a, r):
            return np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(r))) if r > 0.4 else a
        ease = lambda x: x * x * (3 - 2 * x)
        def mix(frm, to, i):
            p = ease((i + 1) / (D + 1))
            a = blurred(frm, MAXR * p).astype(np.float32)
            b = blurred(to, MAXR * (1 - p)).astype(np.float32)
            return (a * (1 - p) + b * p).round().astype(np.uint8)
        for i in range(D):
            enc.stdin.write(mix(last, lock[i], i).tobytes())
        for f in lock[D:len(lock) - D]:
            enc.stdin.write(f.tobytes())
        for i in range(D):
            enc.stdin.write(mix(lock[len(lock) - D + i], last, i).tobytes())
        for _ in range(30):
            enc.stdin.write(last.tobytes())
    enc.stdin.close()
    enc.wait()
    print(f'{args.output}: tour {tour_frames / FPS:.1f} s', file=sys.stderr)


if __name__ == '__main__':
    main()
