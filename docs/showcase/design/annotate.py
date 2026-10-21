#!/usr/bin/env python3
"""The README's design images: real frames of the desktop with the standard drawn over them.

  annotate.py SOURCES LOGO OUT

SOURCES: the redacted showcase stills (2560x1440; calendar.png). LOGO: the title's logo frame
(docs/showcase/title/render.py still 5.8). OUT: docs/showcase/media.

  design-glass.webp     the glass's anatomy on the title's capsule (glass.glsl, glass_params())
  design-corners.webp   concentric corners on the calendar (docs/STANDARD.md): the 32 px panel,
                        the 20 px cards and the 40 px Clear button share their corners' centres
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = next((p for p in (Path(__file__).resolve().parents[1] / 'title/fonts/SpaceGrotesk-Variable.ttf',)
             if p.exists()))
INK = (255, 255, 255)
ACCENT = (120, 220, 255)


def font(size, weight=500):
    f = ImageFont.truetype(str(FONT), size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass
    return f


def label(draw, xy, text, anchor_xy, size=26, align='left'):
    """a caption on a dark capsule at `xy`, with a leader line to `anchor_xy`"""
    f = font(size)
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    w, h = r - l, b - t
    pad_x, pad_y = 16, 10
    x, y = xy
    if align == 'right':
        x -= w + 2 * pad_x
    box = (x, y, x + w + 2 * pad_x, y + h + 2 * pad_y)
    # the leader starts at the capsule's nearest edge
    sx = min(max(anchor_xy[0], box[0]), box[2])
    sy = min(max(anchor_xy[1], box[1]), box[3])
    draw.line([(sx, sy), anchor_xy], fill=ACCENT + (230,), width=3)
    draw.ellipse([anchor_xy[0] - 6, anchor_xy[1] - 6, anchor_xy[0] + 6, anchor_xy[1] + 6], fill=ACCENT + (255,))
    draw.rounded_rectangle(box, radius=(h + 2 * pad_y) // 2, fill=(14, 10, 22, 205), outline=(255, 255, 255, 60), width=1)
    draw.text((x + pad_x - l, y + pad_y - t), text, font=f, fill=INK)


def glass_anatomy(logo, out):
    # the logo frame (1920x1080); the capsule spans x 1207 to 1770, y 423 to 693
    im = Image.open(logo).convert('RGB').crop((560, 250, 1920, 1015))
    ox, oy = 560, 250
    over = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    p = lambda x, y: (x - ox, y - oy)
    label(d, p(700, 300), 'Rim light, lit from the top left  (0.55)', p(1262, 436))
    label(d, p(640, 760), 'Refraction band: the edge bends what is under it', p(1268, 668))
    label(d, p(1900, 300), 'Clear: no tint, a 7 % lens', p(1560, 470), align='right')
    label(d, p(1900, 880), 'Edge shadow inside (0.30), drop shadow under (0.20)', p(1712, 690), align='right')
    im = Image.alpha_composite(im.convert('RGBA'), over).convert('RGB')
    im.save(out / 'design-glass.webp', quality=88, method=6)


def concentric(calendar, out):
    """the calendar's bottom corners at 3x, the circles of their corners drawn"""
    src = Image.open(calendar).convert('RGB')
    scale = 3
    panels = []
    # bottom left: the panel corner (32) and the Clear button (40 tall, 12 in): one centre
    # bottom right: the panel corner (32) and the Weather card (20, 12 in): one centre
    for (x0, y0), circles, captions in (
        ((925, 402), [((979, 650), 32, 'panel 32'), ((978, 651), 20, 'button 20 = 40 / 2')], ('Clear button', '12 + 20 = 32')),
        ((1360, 402), [((1581, 650), 32, 'panel 32'), ((1583, 652), 20, 'card 20')], ('Weather card', '12 + 20 = 32')),
    ):
        # two 264 x 300 panels at 3x side by side: one 16:9 image (1600 x 900)
        crop = src.crop((x0, y0, x0 + 264, y0 + 300)).resize((264 * scale, 300 * scale), Image.LANCZOS).convert('RGBA')
        over = Image.new('RGBA', crop.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        for (cx, cy), r, _ in circles:
            X, Y, R = (cx - x0) * scale, (cy - y0) * scale, r * scale
            d.ellipse([X - R, Y - R, X + R, Y + R], outline=ACCENT + (235,), width=3)
        cx, cy = circles[0][0]
        X, Y = (cx - x0) * scale, (cy - y0) * scale
        d.ellipse([X - 7, Y - 7, X + 7, Y + 7], fill=(255, 255, 255, 255))
        f, fb = font(28), font(34, 600)
        line2 = f'{captions[1]}, one centre'
        w = max(d.textlength(captions[0], font=fb), d.textlength(line2, font=f))
        d.rounded_rectangle((14, 14, 14 + w + 36, 120), radius=26, fill=(14, 10, 22, 215), outline=(255, 255, 255, 60))
        d.text((32, 22), captions[0], font=fb, fill=INK)
        d.text((32, 70), line2, font=f, fill=ACCENT)
        panels.append(Image.alpha_composite(crop, over).convert('RGB'))
    gap = 16
    sheet = Image.new('RGB', (sum(p.width for p in panels) + gap, panels[0].height), (12, 10, 18))
    sheet.paste(panels[0], (0, 0))
    sheet.paste(panels[1], (panels[0].width + gap, 0))
    sheet.save(out / 'design-corners.webp', quality=88, method=6)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sources, logo, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    glass_anatomy(logo, out)
    concentric(sources / 'calendar.png', out)


if __name__ == '__main__':
    main()
