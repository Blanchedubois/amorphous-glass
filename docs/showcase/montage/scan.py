#!/usr/bin/env python3
"""Scan a rendered video for personal details the redaction missed, before it is published.

  scan.py VIDEO [--every 0.25]

Reads every `--every` seconds of VIDEO with tesseract and matches the words against the redaction
terms: docs/showcase/redactions.json and the private ones in
~/.config/tahoe-glass/showcase-redact-terms.json (kept outside the repo). It prints only where a
term was found (time and box), never the matched text, and exits 1 when anything is found.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def terms():
    found = list(json.loads((REPO / 'docs/showcase/redactions.json').read_text()).get('terms', []))
    private = Path.home() / '.config/tahoe-glass/showcase-redact-terms.json'
    if private.exists():
        found += json.loads(private.read_text()).get('terms', [])
    return [re.compile(t, re.I) for t in found]


def words(png):
    tsv = subprocess.run(['tesseract', str(png), '-', '--psm', '11', 'tsv'],
                         capture_output=True, text=True).stdout.splitlines()[1:]
    for row in tsv:
        cols = row.split('\t')
        if len(cols) == 12 and cols[11].strip():
            yield cols[11].strip(), tuple(int(c) for c in cols[6:10])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--every', type=float, default=0.25)
    args = ap.parse_args()
    patterns = terms()
    hits = 0
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', args.video, '-vf', f'fps={1 / args.every}',
                        f'{tmp}/%05d.png'], check=True)
        for png in sorted(Path(tmp).glob('*.png')):
            t = (int(png.stem) - 1) * args.every
            text = list(words(png))
            line = ' '.join(w for w, _ in text)
            for p in patterns:
                for w, box in text:
                    if p.search(w) or (p.search(line) and p.pattern.lower() in w.lower()):
                        print(f'{t:7.2f} s  term #{patterns.index(p)} at {box}')
                        hits += 1
    print(f'{hits} hit(s)')
    sys.exit(1 if hits else 0)


if __name__ == '__main__':
    main()
