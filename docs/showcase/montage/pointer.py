#!/usr/bin/env python3
"""The cursor's exact path in each clip, from the shoot's own log (montage_shoot.py).

  pointer.py SHOOT WORK [CLIP..]

SHOOT: the folder montage_shoot.py wrote (the clips and montage.jsonl). WORK: where the paths go,
as CLIP.track.json in the tracker's format (edit.py reads them as it reads track.py's), one point
per 60 fps frame of the clip.

The log has every move, drag and click with the moment it was sent; the driver glides on a known
ease in-out, so the path between those moments is exact. What the log does not know is when the
screencast's first frame was taken; that offset is found by matching the path to the cursor that
track.py sees in the frames (its confident matches, where the cursor moves), over -0.5 to 1.5 s in
10 ms steps.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
FPS = 60
GOOD = 30.0


def ease(t, curve=None):
    """a glide's curve: moves are ease-out quart (montage_shoot.py steps them), drags the driver's own
    ease in-out (shoots before 2026-10-21 evening: TAHOE_POINTER_EASE=inout for moves too)"""
    if curve == 'inout' or os.environ.get('TAHOE_POINTER_EASE') == 'inout':
        return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2
    return 1 - (1 - t) ** 4


def segments(entries):
    """(start s, end s, x0, y0, x1, y1) glides, and the clip's first position; times from the request"""
    clip = entries[0]
    t0 = clip['requested']
    pos = tuple(clip['cursor'])
    glides = []
    for e in entries[1:]:
        t = e['t'] - t0
        if 'move' in e:
            x0, y0, x1, y1, ms = e['move']
            glides.append((t, t + ms / 1000, x0, y0, x1, y1, None))
        elif 'drag' in e:
            x0, y0, x1, y1, ms = e['drag']
            start = t + 0.15                    # the driver presses, waits, then glides
            glides.append((start, start + ms / 1000, x0, y0, x1, y1, 'inout'))
        elif 'click' in e:
            x, y, _ = e['click']
            glides.append((t, t, x, y, x, y, None))
    return pos, glides


def path(pos, glides, times):
    out = np.empty((len(times), 2))
    for i, t in enumerate(times):
        x, y = pos
        for a, b, x0, y0, x1, y1, curve in glides:
            if t < a:
                break
            if t >= b:
                x, y = x1, y1
            else:
                e = ease((t - a) / (b - a), curve)
                x, y = x0 + (x1 - x0) * e, y0 + (y1 - y0) * e
        out[i] = (x, y)
    return out


def clips(log):
    """the log's entries per clip: from its 'clip' line to its 'clip_end' line"""
    out, cur = {}, None
    for e in log:
        if 'clip' in e:
            cur = [e]
        elif 'clip_end' in e and cur:
            out[e['clip_end']] = cur
            cur = None
        elif cur is not None:
            cur.append(e)
    return out


def frames_in(video):
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(video)],
                             capture_output=True, text=True, check=True).stdout)
    return int(d * FPS)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    shoot, work = Path(sys.argv[1]), Path(sys.argv[2])
    work.mkdir(parents=True, exist_ok=True)
    log = [json.loads(l) for l in (shoot / 'montage.jsonl').read_text().splitlines() if l.strip()]
    per = clips(log)                            # a retaken clip: the last take wins
    names = sys.argv[3:] or sorted(per)
    for name in names:
        video = shoot / f'{name}.mp4'
        if name not in per or not video.exists():
            continue
        pos, glides = segments(per[name])
        n = frames_in(video)
        seen = work / f'{name}.seen.json'      # what the tracker sees, for the offset
        if not seen.exists():
            subprocess.run([sys.executable, str(HERE / 'track.py'), str(video), '-o', str(seen)], check=True,
                           stderr=subprocess.DEVNULL)
        pts = json.loads(seen.read_text())['points']
        ok = [(i, p[0], p[1]) for i, p in enumerate(pts) if p[0] is not None and p[2] <= GOOD]
        best = (0.4, None)
        if len(ok) > 10:
            idx = np.array([o[0] for o in ok])
            xy = np.array([[o[1], o[2]] for o in ok], dtype=float)
            # only frames where the cursor moves: resting frames fit any offset
            moving = np.r_[False, np.hypot(*np.diff(xy, axis=0).T) > 3]
            if moving.sum() > 10:
                idx, xy = idx[moving], xy[moving]
            errs = []
            for offset in np.arange(-0.5, 1.5, 0.01):
                p = path(pos, glides, idx / FPS + offset)
                errs.append((float(np.median(np.hypot(*(p - xy).T))), offset))
            err, off = min(errs)
            best = (off, err)
        offset = best[0]
        full = path(pos, glides, np.arange(n) / FPS + offset)
        (work / f'{name}.track.json').write_text(json.dumps(
            {'fps': FPS, 'source': 'log', 'offset': round(offset, 3),
             'points': [[round(x, 2), round(y, 2), 0] for x, y in full]}))
        err = f'{best[1]:.1f} px median' if best[1] is not None else 'no tracker match: 0.4 s assumed'
        print(f'{name}: offset {offset:.2f} s ({err})')


if __name__ == '__main__':
    main()
