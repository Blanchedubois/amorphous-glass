#!/usr/bin/env python3
"""Cut the montage: the shots of edit.json, each seen through a camera that follows the cursor.

  edit.py SOURCES WORK -o montage.mp4 [--only SHOT]

SOURCES: the redacted screencasts and stills (2560x1440; the lock clips 1920x1080). WORK: a folder
for the cursor tracks and the motion scans, kept between runs. The output is 1920x1080, 60 fps.

Per shot (edit.json):
  clip / still   the source
  box            the region of interest [x, y, w, h] in source pixels: the camera frames it
  len            seconds on screen
  in             where the shot starts in the clip, or "auto": the busiest stretch of the clip
                 (frame-to-frame motion), a quarter second before it

  cursor         true: the camera keeps the cursor in the middle, zoomed in at `zoom`; it zooms
                 out as the cursor travels and back in as it settles (otherwise it frames `box`)
  from_zoom      the zoom the shot starts at (default: a little wider than its own, so it pushes in)
  end_zoom       the zoom it heads to over its second half (1: back out to the whole screen)
  redact         blur boxes [x, y, w, h, from_s, to_s] (source pixels, clip time) for personal
                 details the shoot's redaction missed

The camera moves on critically damped springs (the desktop's spring.js model: no overshoot). The
cuts are hard cuts on the action.
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
OUT_W, OUT_H, FPS = 1920, 1080, 60
MAX_ZOOM = 2.2                  # above this the upscaled UI text goes soft
PUSH = 0.88                     # each shot starts at this fraction of its zoom
CAMERA = {'damping': 1.0, 'stiffness': 28.0}
CURSOR = {'damping': 1.0, 'stiffness': 60.0}   # the cursor camera keeps up, without overshoot
ZOOM = {'damping': 1.0, 'stiffness': 14.0}


class Spring:
    """the exact damped harmonic oscillator of tahoe-motion's spring.js (mass 1)"""

    def __init__(self, value, token):
        self.value, self.target, self.velocity = value, value, 0.0
        self.w, self.z = math.sqrt(token['stiffness']), token['damping']

    def step(self, dt):
        w, z, u0, v0 = self.w, self.z, self.value - self.target, self.velocity
        if z < 1:
            wd = w * math.sqrt(1 - z * z)
            d, c, s = math.exp(-z * w * dt), math.cos(wd * dt), math.sin(wd * dt)
            u = d * (u0 * c + (v0 + z * w * u0) / wd * s)
            v = d * (v0 * c - (z * w * v0 + w * w * u0) / wd * s)
        else:
            d, b = math.exp(-w * dt), v0 + w * u0
            u, v = (u0 + b * dt) * d, (v0 - w * b * dt) * d
        self.value, self.velocity = self.target + u, v
        return self.value


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=width,height:format=duration', '-of', 'json', str(path)],
                         capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    s = info['streams'][0]
    return s['width'], s['height'], float(info['format'].get('duration', 0))


def motion(clip, work):
    """frame-to-frame motion of a clip at 30 fps (cached)"""
    cache = work / f'{clip.stem}.motion.json'
    if cache.exists():
        return json.loads(cache.read_text())
    proc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', str(clip), '-vf', 'fps=30,scale=160:90,format=gray',
                             '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    prev, energy = None, []
    while True:
        buf = proc.stdout.read(160 * 90)
        if len(buf) < 160 * 90:
            break
        f = np.frombuffer(buf, np.uint8).astype(np.float32)
        energy.append(float(np.abs(f - prev).mean()) if prev is not None else 0.0)
        prev = f
    proc.wait()
    cache.write_text(json.dumps(energy))
    return energy


def auto_in(clip, length, work):
    e = np.array(motion(clip, work))
    n = int(length * 30)
    if len(e) <= n:
        return 0.0
    sums = np.convolve(e, np.ones(n), 'valid')
    return max(0.0, int(np.argmax(sums)) / 30 - 0.25)


def cursor_track(clip, work):
    path = work / f'{clip.stem}.track.json'
    if not path.exists():
        subprocess.run([sys.executable, str(HERE / 'track.py'), str(clip), '-o', str(path)], check=True)
    return json.loads(path.read_text())['points']


def frames(clip, start, length):
    w, h, _ = probe(clip)
    proc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', str(clip),
                             '-t', f'{length:.3f}', '-vf', f'fps={FPS}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                            stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield Image.frombuffer('RGB', (w, h), buf, 'raw', 'RGB', 0, 1)
    proc.wait()


def render_shot(shot, sources, work, sink):
    length = shot['len']
    count = round(length * FPS)
    if 'still' in shot:
        still = Image.open(sources / shot['still']).convert('RGB')
        src_w, src_h = still.size
        images = (still for _ in range(count))
        track, start = None, 0.0
    else:
        clip = sources / shot['clip']
        src_w, src_h, _ = probe(clip)
        start = auto_in(clip, length, work) if shot.get('in', 'auto') == 'auto' else float(shot['in'])
        track = cursor_track(clip, work) if shot.get('cursor') else None
        images = frames(clip, start, length)

    dt = 1 / FPS
    if track:
        # the cursor camera: the cursor stays in the middle; zoomed in at the shot's `zoom`, it
        # breathes out as the cursor travels (to show where it goes) and back in as it settles,
        # with a faint push-in over the shot
        base = min(MAX_ZOOM, shot.get('zoom', 1.9))
        first = next(((p[0], p[1]) for p in track[round(start * 60):] if p[0] is not None), (src_w / 2, src_h / 2))
        cx, cy = Spring(first[0], CURSOR), Spring(first[1], CURSOR)
        z = Spring(shot.get('from_zoom', base * PUSH), ZOOM)
    else:
        bx, by, bw, bh = shot.get('box') or [0, 0, src_w, src_h]
        base = min(MAX_ZOOM, max(1.0, src_w / max(bw, bh * 16 / 9)))
        cx, cy = Spring(bx + bw / 2, CAMERA), Spring(by + bh / 2, CAMERA)
        z = Spring(shot.get('from_zoom', base * PUSH if shot.get('push', True) else base), ZOOM)
    z.target = base
    speed, last = 0.0, None
    n = 0
    for n, im in enumerate(images):
        if n >= count:
            break
        progress = n / max(1, count - 1)
        if track:
            i = min(len(track) - 1, round((start + n * dt) * 60))
            px, py, _ = track[i]
            if px is not None:
                if last is not None:
                    v = math.hypot(px - last[0], py - last[1]) / dt
                    speed += (v - speed) * (1 - math.exp(-dt / 0.25))
                last = (px, py)
                cx.target, cy.target = px, py
            z.target = base * (1 + 0.06 * progress) / (1 + speed / 1800)
        if 'end_zoom' in shot and progress > 0.55:
            z.target = shot['end_zoom']
        for s in (cx, cy, z):
            s.step(dt)
        # privacy: blur boxes [x, y, w, h, from_s, to_s] in source pixels and clip time, for what
        # the shoot's redaction missed (text it could not read while it was animating)
        t_src = start + n * dt
        boxes = [r for r in shot.get('redact', []) if r[4] <= t_src <= r[5]]
        if boxes:
            im = im.copy()   # the decoded frame is read-only
            for x, y, w, h, _, _ in boxes:
                im.paste(im.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(14)), (x, y))
        zv = max(1.0, z.value)   # never wider than the source
        vw, vh = src_w / zv, src_w / zv * OUT_H / OUT_W
        x0 = min(max(cx.value - vw / 2, 0), src_w - vw)
        y0 = min(max(cy.value - vh / 2, 0), src_h - vh)
        frame = im.resize((OUT_W, OUT_H), Image.LANCZOS, box=(x0, y0, x0 + vw, y0 + vh))
        sink.write(frame.tobytes())
    # a clip shorter than asked: hold its last frame
    for _ in range(n + 1, count):
        sink.write(frame.tobytes())
    print(f'  {shot["name"]}: {count} frames from {start:.2f} s, zoom {base:.2f}', file=sys.stderr)
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sources', type=Path)
    ap.add_argument('work', type=Path)
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--edit', type=Path, default=HERE / 'edit.json')
    ap.add_argument('--only', help='render one shot (a preview)')
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    shots = json.loads(args.edit.read_text())['shots']
    if args.only:
        shots = [s for s in shots if s['name'] == args.only]
    enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264',
                            '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', args.output], stdin=subprocess.PIPE)
    total = sum(render_shot(s, args.sources, args.work, enc.stdin) for s in shots)
    enc.stdin.close()
    enc.wait()
    print(f'{args.output}: {total / FPS:.1f} s', file=sys.stderr)


if __name__ == '__main__':
    main()
