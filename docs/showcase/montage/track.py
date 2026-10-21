#!/usr/bin/env python3
"""Find the cursor in every frame of a screencast clip: the camera follows it (edit.py).

The screencast draws the cursor into the video. Its exact sprite comes from the cursor theme's
Xcursor file, and each frame is matched against the sprite's opaque pixels only, so whatever is
under the cursor does not matter. The search starts over the whole frame and then stays near the
last position; where the match is poor (the cursor hidden, or moving fast enough to blur) the last
good position is kept.

  track.py CLIP.mp4 -o CLIP.track.json [--fps 60] [--theme MacTahoe-dark --size 24]

Output: {"fps": 60, "hot": [x, y], "points": [[x, y, score], ...]}, the hotspot in source pixels,
one point per frame; score is the mean absolute difference over the sprite (0 to 255, lower is
better; below about 30 is a confident match).
"""

import argparse
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

IMAGE_TYPE = 0xFFFD0002
GOOD = 30.0          # mean abs difference below this: a match
NEAR = 160           # px searched around the last position


def xcursor_sprite(path, size):
    """the image of nominal `size` from an Xcursor file: (rgba float array, (xhot, yhot))"""
    data = Path(path).read_bytes()
    if data[:4] != b'Xcur':
        sys.exit(f'{path}: not an Xcursor file')
    _, _, ntoc = struct.unpack_from('<III', data, 4)
    best = None
    for i in range(ntoc):
        typ, subtype, pos = struct.unpack_from('<III', data, 16 + i * 12)
        if typ == IMAGE_TYPE and (best is None or abs(subtype - size) < abs(best[0] - size)):
            best = (subtype, pos)
    _, _, _, _, w, h, xhot, yhot, _ = struct.unpack_from('<IIIIIIIII', data, best[1])
    argb = np.frombuffer(data, dtype='<u4', count=w * h, offset=best[1] + 36).reshape(h, w)
    a = ((argb >> 24) & 255).astype(np.float32)
    rgb = np.stack([(argb >> 16) & 255, (argb >> 8) & 255, argb & 255], axis=-1).astype(np.float32)
    # premultiplied: un-premultiply where opaque enough to matter
    rgb = np.where(a[..., None] > 0, rgb * 255 / np.maximum(a[..., None], 1), 0)
    return np.dstack([rgb, a]), (xhot, yhot)


def frames(clip, fps):
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'stream=width,height', '-of', 'csv=p=0', clip],
                           capture_output=True, text=True, check=True).stdout.strip().split(',')
    w, h = int(probe[0]), int(probe[1])
    proc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', clip, '-vf', f'fps={fps}',
                             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    proc.wait()


def scores(frame, sprite, mask, region):
    """the score of every top-left corner inside `region` (x0, y0, x1, y1), and the region's origin"""
    sh, sw = mask.shape
    x0, y0, x1, y1 = region
    x1, y1 = min(x1, frame.shape[1] - sw), min(y1, frame.shape[0] - sh)
    if x1 <= x0 or y1 <= y0:
        return None, (x0, y0)
    area = frame[y0:y1 + sh, x0:x1 + sw].astype(np.float32)
    win = np.lib.stride_tricks.sliding_window_view(area, (sh, sw, 3))[:, :, 0]
    return np.abs(win[..., mask, :] - sprite[mask][None, None]).mean(axis=(-1, -2)), (x0, y0)


def match(frame, sprite, mask, region):
    """the best top-left corner for the sprite inside `region` (x0, y0, x1, y1) and its score"""
    diff, (x0, y0) = scores(frame, sprite, mask, region)
    if diff is None:
        return None, 1e9
    iy, ix = np.unravel_index(np.argmin(diff), diff.shape)
    return (int(x0 + ix), int(y0 + iy)), float(diff[iy, ix])


def search_all(frame, sprite, mask, candidates=40):
    """the whole frame: a coarse pass at a quarter of the size finds candidates (busy pictures,
    like album art, can look more like a quarter-size cursor than the cursor does), and each of
    the best ones is matched again at full size"""
    small = frame[::4, ::4]
    diff, _ = scores(small, sprite[::4, ::4], mask[::4, ::4], (0, 0, small.shape[1], small.shape[0]))
    if diff is None:
        return None, 1e9
    flat = np.argpartition(diff.ravel(), candidates)[:candidates]
    best = (None, 1e9)
    for iy, ix in zip(*np.unravel_index(flat, diff.shape)):
        cx, cy = int(ix) * 4, int(iy) * 4
        found, score = match(frame, sprite, mask, (max(0, cx - 6), max(0, cy - 6), cx + 6, cy + 6))
        if score < best[1]:
            best = (found, score)
    return best


def track(clip, fps, sprite_rgba, hot):
    sprite = sprite_rgba[..., :3]
    mask = sprite_rgba[..., 3] > 240
    points = []
    last = None
    for n, frame in enumerate(frames(clip, fps)):
        found, score = (None, 1e9)
        if last is not None:
            found, score = match(frame, sprite, mask,
                                 (max(0, last[0] - NEAR), max(0, last[1] - NEAR), last[0] + NEAR, last[1] + NEAR))
        if score > GOOD:
            # lost: search the whole frame
            found2, score2 = search_all(frame, sprite, mask)
            if score2 < score:
                found, score = found2, score2
        if score <= GOOD:
            last = found
        x, y = (last[0] + hot[0], last[1] + hot[1]) if last else (None, None)
        points.append([x, y, round(score, 1)])
        if n % 60 == 0:
            print(f'  {Path(clip).name} frame {n}: {x}, {y} ({score:.1f})', file=sys.stderr)
    # frames before the first match take the first match
    first = next((p for p in points if p[0] is not None), None)
    for p in points:
        if p[0] is None and first:
            p[0], p[1] = first[0], first[1]
    return points


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('clip')
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--fps', type=int, default=60)
    ap.add_argument('--theme', default='MacTahoe-dark')
    ap.add_argument('--size', type=int, default=24)
    args = ap.parse_args()
    for base in (Path.home() / '.local/share/icons', Path.home() / '.icons', Path('/usr/share/icons')):
        cur = base / args.theme / 'cursors' / 'default'
        if cur.exists():
            break
    else:
        sys.exit(f'cursor theme {args.theme} not found')
    sprite, hot = xcursor_sprite(cur, args.size)
    points = track(args.clip, args.fps, sprite, hot)
    good = sum(1 for p in points if p[2] <= GOOD)
    Path(args.output).write_text(json.dumps({'fps': args.fps, 'hot': list(hot), 'points': points}))
    print(f'{args.output}: {good}/{len(points)} frames matched', file=sys.stderr)


if __name__ == '__main__':
    main()
