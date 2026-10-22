#!/usr/bin/env python3
"""A sheet of the frames around each cut of a montage render, to check the cuts by eye.

  cutcheck.py VIDEO OUT.png CUT [CUT..] [--edit edit.json]

CUT is the cut's number (1: between the first and second shots). Per cut, one row: the last three
frames of the shot before it, the first three of the shot after it (the cut is the line between
them), and frames +12 and +30, to see where the motion goes. Frame offsets are printed on each
frame; the shot names on the row.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
W, H = 400, 225
OFFSETS = (-3, -2, -1, 0, 1, 2, 12, 30)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('out')
    ap.add_argument('cuts', type=int, nargs='+')
    ap.add_argument('--edit', type=Path, default=HERE / 'edit.json')
    args = ap.parse_args()
    shots = json.loads(args.edit.read_text())['shots']
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', args.video, '-vf', f'scale={W}:{H}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    bounds = np.cumsum([round(s['len'] * 60) for s in shots])
    rows = []
    for c in args.cuts:
        b = int(bounds[c - 1])
        tiles = []
        for o in OFFSETS:
            im = Image.fromarray(frames[min(max(b + o, 0), len(frames) - 1)].copy())
            d = ImageDraw.Draw(im)
            d.rectangle((0, 0, 40, 14), fill=(0, 0, 0))
            d.text((3, 2), f'{o:+d}', fill=(255, 255, 0))
            if o == 0:
                d.line([(0, 0), (0, H)], fill=(255, 60, 60), width=3)
            tiles.append(np.asarray(im))
        row = Image.fromarray(np.concatenate(tiles, axis=1))
        d = ImageDraw.Draw(row)
        label = f'cut {c}: {shots[c - 1]["name"]}  |  {shots[c]["name"]}'
        d.rectangle((0, H - 16, 8 * len(label), H), fill=(0, 0, 0))
        d.text((3, H - 14), label, fill=(0, 255, 255))
        rows.append(np.asarray(row))
    Image.fromarray(np.concatenate(rows, axis=0)).save(args.out)


if __name__ == '__main__':
    main()
