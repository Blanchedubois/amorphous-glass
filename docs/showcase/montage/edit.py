#!/usr/bin/env python3
"""Cut the montage: the shots of an edit list, seen through a camera locked to the cursor.

  edit.py SOURCES WORK -o montage.mp4 [--edit edit.json] [--only SHOT] [--draft]

SOURCES: the redacted screencasts and stills (2560x1440; the lock clips 1920x1080). WORK: a folder
for the cursor tracks, kept between runs. The output is 1920x1080, 60 fps (--draft: 960x540, no
motion blur, for review).

The camera (REWRITE.md, user 2026-10-21: "always keep the cursor in the center of the screen ...
just keep it zoomed in following the cursor"):
  - one zoom for the whole montage (edit list "zoom", 1.6); no zoom move, ever;
  - the cursor's hotspot is the exact centre of every frame;
  - beyond the screen's edge the Fold wallpaper continues, dimmed, and the screen is a card on it
    (rounded corners, a soft shadow, a hairline edge), so a cursor on the top bar or the dock still
    sits in the middle;
  - it moves exactly as fast as the cursor, so the frame is blurred along the camera's path (several
    camera positions over the same source frame, a 180 degree shutter).

Per shot:
  clip / still   the source
  in, len        where in the clip the shot starts, and its length (s)
  cursor         [x, y]: where the cursor is when the source has none (a still, the lock screen)
  dissolve       frames of cross-dissolve from the previous shot (default 0: a cut)
  zoom           this shot's zoom instead of the montage's (1: the whole screen; the lock screen,
                 user 2026-10-21: "make that full screen"); a cut, never a zoom move
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
WALLPAPER = REPO / 'docs/showcase/title/plates/fold-d.webp'   # 1920x1080 crop of fold-d
OUT_W, OUT_H, FPS = 1920, 1080, 60
CORNER = 28            # the screen card's corner radius, in source pixels
SHUTTER = 0.5          # of a frame: the motion blur's exposure
MAX_SAMPLES = 24       # camera positions per frame at most, when it moves
SMOOTH = 3             # frames the tracked cursor is averaged over (the tracker's 1 px noise)
JUMP = 200             # px in one frame: the tracker re-finding the cursor, not a move


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=width,height', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout.strip().split(',')
    return int(out[0]), int(out[1])


def frames(clip, start, length):
    w, h = probe(clip)
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


def cursor_track(clip, work):
    """the cursor's hotspot per 60 fps frame, smoothed over SMOOTH frames"""
    path = work / f'{clip.stem}.track.json'
    if not path.exists():
        subprocess.run([sys.executable, str(HERE / 'track.py'), str(clip), '-o', str(path)], check=True)
    pts = json.loads(path.read_text())['points']
    xy = np.array([[p[0], p[1]] if p[0] is not None else [np.nan, np.nan] for p in pts], dtype=float)
    # hold the last known position over gaps
    for i in range(1, len(xy)):
        if np.isnan(xy[i, 0]):
            xy[i] = xy[i - 1]
    k = np.ones(SMOOTH) / SMOOTH
    pad = np.pad(xy, ((SMOOTH // 2, SMOOTH // 2), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, 0], k, 'valid'), np.convolve(pad[:, 1], k, 'valid')], axis=1)


def position(track, t):
    """the cursor at clip time t (s), between 60 fps samples"""
    f = min(max(t * 60, 0), len(track) - 1)
    i = int(f)
    j = min(i + 1, len(track) - 1)
    return track[i] + (track[j] - track[i]) * (f - i)


class Stage:
    """the screen as a card on the wallpaper, `pad` source pixels of wallpaper on every side"""

    def __init__(self, size, zoom):
        w, h = size
        self.size = size
        self.pad = pad = int(np.ceil(max(w / zoom, w / zoom * OUT_H / OUT_W) / 2)) + 4
        cw, ch = w + 2 * pad, h + 2 * pad
        wall = Image.open(WALLPAPER).convert('RGB')
        s = max(cw / wall.width, ch / wall.height)
        wall = wall.resize((round(wall.width * s), round(wall.height * s)), Image.LANCZOS)
        left, top = (wall.width - cw) // 2, (wall.height - ch) // 2
        bg = ImageEnhance.Brightness(wall.crop((left, top, left + cw, top + ch))).enhance(0.72)
        shadow = Image.new('L', (cw, ch), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 14, pad + w, pad + h + 14), CORNER, fill=160)
        bg.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(34)))
        self.background = bg
        self.mask = Image.new('L', size, 0)
        ImageDraw.Draw(self.mask).rounded_rectangle((0, 0, w - 1, h - 1), CORNER, fill=255)
        self.edge = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        ImageDraw.Draw(self.edge).rounded_rectangle((pad, pad, pad + w - 1, pad + h - 1), CORNER,
                                                    outline=(255, 255, 255, 70), width=2)
        self.view = (w / zoom, w / zoom * OUT_H / OUT_W)

    def compose(self, screen):
        canvas = self.background.copy()
        canvas.paste(screen, (self.pad, self.pad), self.mask)
        canvas.paste(self.edge, (0, 0), self.edge)
        return canvas

    def shoot(self, canvas, centres, out_size):
        """the view around each centre (source pixels), averaged: one frame"""
        vw, vh = self.view
        acc = None
        for cx, cy in centres:
            x0, y0 = cx + self.pad - vw / 2, cy + self.pad - vh / 2
            im = np.asarray(canvas.resize(out_size, Image.LANCZOS, box=(x0, y0, x0 + vw, y0 + vh)), dtype=np.float32)
            acc = im if acc is None else acc + im
        return (acc / len(centres)).round().astype(np.uint8)


def render_shot(shot, sources, work, zoom, out_size, draft, sink, previous):
    length = shot['len']
    count = round(length * FPS)
    start = float(shot.get('in', 0))
    if 'still' in shot:
        still = Image.open(sources / shot['still']).convert('RGB')
        images = (still for _ in range(count))
        size = still.size
    else:
        clip = sources / shot['clip']
        size = probe(clip)
        images = frames(clip, start, length)
    track = None
    if 'cursor' not in shot:
        track = cursor_track(sources / shot['clip'], work)
    stage = Stage(size, zoom)
    dissolve = int(shot.get('dissolve', 0))
    dt = 1 / FPS
    last = None
    n = -1
    for n, im in enumerate(images):
        if n >= count:
            break
        t = start + n * dt
        if track is None:
            centres = [tuple(shot['cursor'])]
        else:
            here = position(track, t)
            before = position(track, t - SHUTTER * dt)
            moved = np.hypot(*(here - before))
            # a jump no hand makes in a frame is the tracker re-finding a lost cursor: a cut, not a whip
            if moved > JUMP:
                before = here
            # enough positions that the blur is a streak, not stepped copies: one per 4 px of travel
            samples = 1 if draft or moved < 0.75 or moved > JUMP else int(min(MAX_SAMPLES, max(3, moved / 4)))
            centres = [tuple(before + (here - before) * k / max(1, samples - 1)) for k in range(samples)]
        out = stage.shoot(stage.compose(im), centres, out_size)
        if previous is not None and n < dissolve:
            a = (n + 1) / (dissolve + 1)
            out = (previous.astype(np.float32) * (1 - a) + out.astype(np.float32) * a).round().astype(np.uint8)
        sink.write(out.tobytes())
        last = out
    for _ in range(n + 1, count):   # a clip shorter than asked: hold its last frame
        sink.write(last.tobytes())
    print(f'  {shot["name"]}: {count} frames from {start:.2f} s', file=sys.stderr)
    return count, last


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sources', type=Path)
    ap.add_argument('work', type=Path)
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--edit', type=Path, default=HERE / 'edit.json')
    ap.add_argument('--only', help='render one shot')
    ap.add_argument('--draft', action='store_true', help='960x540, no motion blur')
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    edit = json.loads(args.edit.read_text())
    shots = [s for s in edit['shots'] if not args.only or s['name'] == args.only]
    out_size = (OUT_W // 2, OUT_H // 2) if args.draft else (OUT_W, OUT_H)
    enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{out_size[0]}x{out_size[1]}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264',
                            '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', args.output], stdin=subprocess.PIPE)
    total, previous = 0, None
    for shot in shots:
        count, previous = render_shot(shot, args.sources, args.work, shot.get('zoom', edit.get('zoom', 1.6)), out_size,
                                      args.draft, enc.stdin, previous)
        total += count
    enc.stdin.close()
    enc.wait()
    print(f'{args.output}: {total / FPS:.1f} s', file=sys.stderr)


if __name__ == '__main__':
    main()
