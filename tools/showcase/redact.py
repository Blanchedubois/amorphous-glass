#!/usr/bin/env python3
"""redact.py RULES IN OUT: blur the sensitive parts of the shoot (docs/SHOWCASE_PLAN.md, Phase 4).

RULES (JSON):                                (plus the personal terms in ~/.config/tahoe-glass/
                                              showcase-redact-terms.json, never committed)
  {"terms": ["regex", ...],                 words found by OCR (tesseract) on every still and on clip
                                            frames sampled every 0.2 s; each match is blurred, padded
   "boxes": {"name": [[x, y, w, h, from_s, to_s], ...]}}  fixed boxes per still/clip (no times = all)
IN holds the shoot's PNGs and MP4s; OUT gets the redacted PNGs and MP4s at full size, plus
OUT/report.json: every box applied and why, for the second review.
Same input, same rules, same output.
"""
import glob, json, os, re, subprocess, sys, tempfile

from PIL import Image, ImageFilter

RULES, IN, OUT = sys.argv[1:4]
rules = json.load(open(RULES))
# the personal terms (names, places, networks) live outside the repo, so publishing the rules does
# not publish what they hide: TAHOE_REDACT_TERMS, else ~/.config/tahoe-glass/showcase-redact-terms.json
private = os.environ.get('TAHOE_REDACT_TERMS', os.path.expanduser('~/.config/tahoe-glass/showcase-redact-terms.json'))
extra = json.load(open(private)).get('terms', []) if os.path.exists(private) else []
if not extra:
    print(f'warning: no personal terms in {private}: only the generic ones are blurred', file=sys.stderr)
TERMS = [re.compile(t, re.I) for t in rules.get('terms', []) + extra]
BOXES = rules.get('boxes', {})
PAD = 10
os.makedirs(OUT, exist_ok=True)
report = {}


def ocr_boxes(img_path):
    """boxes of the words that match a term: tesseract's TSV, a line's words joined for multi-word terms"""
    tsv = subprocess.run(['tesseract', img_path, '-', '--psm', '11', 'tsv'], capture_output=True, text=True).stdout
    words = []
    for line in tsv.splitlines()[1:]:
        f = line.split('\t')
        if len(f) == 12 and f[11].strip() and float(f[10]) > 10:
            words.append((f[11].strip(), int(f[6]), int(f[7]), int(f[8]), int(f[9])))
    out = []
    for text, x, y, w, h in words:
        if any(t.search(text) for t in TERMS):
            out.append([x - PAD, y - PAD, w + 2 * PAD, h + 2 * PAD, text])
    return out


def blur_png(src, dst, boxes):
    im = Image.open(src).convert('RGB')
    for x, y, w, h, *_ in boxes:
        x, y = max(0, x), max(0, y)
        region = im.crop((x, y, x + w, y + h))
        # pixelate then blur: unreadable, and still looks like the glass it sits on
        small = region.resize((max(1, w // 14), max(1, h // 14)), Image.BILINEAR)
        im.paste(small.resize(region.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(6)), (x, y))
    im.save(dst)


def stills():
    for src in sorted(glob.glob(os.path.join(IN, '*.png'))):
        name = os.path.splitext(os.path.basename(src))[0]
        found = ocr_boxes(src)
        fixed = [b[:4] + ['fixed'] for b in BOXES.get(name, [])]
        blur_png(src, os.path.join(OUT, f'{name}.png'), found + fixed)
        report[name] = found + fixed
        print(f'{name}: {len(found)} OCR, {len(fixed)} fixed', flush=True)


def clips():
    for src in sorted(glob.glob(os.path.join(IN, '*.mp4'))):
        name = os.path.splitext(os.path.basename(src))[0]
        boxes = []   # [x, y, w, h, t0, t1, why]
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-vf', 'fps=5', f'{tmp}/f%05d.png'], check=True)
            for f in sorted(glob.glob(f'{tmp}/f*.png')):
                t = (int(os.path.basename(f)[1:6]) - 1) / 5
                # a word OCR read on any frame is blurred for the whole clip: OCR misses words on some
                # frames, and the things it finds (labels, names) do not move
                for x, y, w, h, why in ocr_boxes(f):
                    boxes.append([x, y, w, h, 0, 1e6, why])
        for b in BOXES.get(name, []):
            boxes.append(b[:4] + ([b[4], b[5]] if len(b) > 5 else [0, 1e6]) + ['fixed'])
        boxes = merge(boxes)
        report[name] = boxes
        filters, last = [], '0:v'
        for i, (x, y, w, h, t0, t1, _) in enumerate(boxes):
            x, y = max(0, x), max(0, y)
            # pixelate then soften, as the stills (boxblur alone is capped by the chroma plane's size)
            sw, shh = max(2, w // 14 * 2 // 2), max(2, h // 14)
            filters.append(f'[{last}]split[a{i}][b{i}];[b{i}]crop={w}:{h}:{x}:{y},scale={max(2, w // 14)}:{shh},'
                           f'scale={w}:{h}:flags=bilinear,boxblur=2:1[c{i}];'
                           f"[a{i}][c{i}]overlay={x}:{y}:enable='between(t,{t0:.2f},{t1:.2f})'[v{i}]")
            last = f'v{i}'
        cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-i', src]
        if filters:
            cmd += ['-filter_complex', ';'.join(filters), '-map', f'[{last}]']
        cmd += ['-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', os.path.join(OUT, f'{name}.mp4')]
        subprocess.run(cmd, check=True)
        print(f'{name}: {len(boxes)} boxes', flush=True)


def merge(boxes):
    """one box per place: OCR finds the same word on many frames; join overlapping times at about the same place"""
    out = []
    for b in sorted(boxes, key=lambda b: (b[0] // 20, b[1] // 20, b[4])):
        for o in out:
            if abs(o[0] - b[0]) < 40 and abs(o[1] - b[1]) < 24 and b[4] <= o[5] + 0.5:
                o[0], o[1] = min(o[0], b[0]), min(o[1], b[1])
                o[2] = max(o[0] + o[2], b[0] + b[2]) - o[0]
                o[3] = max(o[1] + o[3], b[1] + b[3]) - o[1]
                o[5] = max(o[5], b[5])
                break
        else:
            out.append(list(b))
    return out


if __name__ == '__main__':
    stills()
    if '--no-clips' not in sys.argv:
        clips()
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
