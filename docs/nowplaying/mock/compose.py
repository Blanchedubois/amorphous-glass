"""compose.py FRAMES OUT: lays render.sh's frames out as the plan's stills (all 16:9)."""
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

frames, out = Path(sys.argv[1]), Path(sys.argv[2])
FONT = '/home/blanched/.local/share/fonts/SF-Pro/SF-Pro-Text-Semibold.otf'
try:
    font = ImageFont.truetype(FONT, 22)
    small = ImageFont.truetype(FONT, 17)
    big = ImageFont.truetype(FONT, 30)
except OSError:
    font = small = big = ImageFont.load_default()

for name in ('lyrics', 'lyrics-notes', 'nolyrics', 'nolyrics-notes'):
    shutil.copy(frames / f'{name}.png', out / f'layout-{name}.png')

# the tilt: two halves side by side, cropped to the left column
a = Image.open(frames / 'tilt-a.png')
b = Image.open(frames / 'tilt-b.png')
sheet = Image.new('RGB', (1920, 1080), (18, 18, 22))
crop = (165, 60, 165 + 900, 60 + 1000)
for i, im in enumerate((a, b)):
    c = im.crop(crop).resize((855, 950))
    sheet.paste(c, (70 + i * 925, 90))
d = ImageDraw.Draw(sheet)
d.text((70, 30), 'Hover: the widgets\' glass outline appears, the cover tilts toward the pointer (max 8°), a sheen follows', font=big, fill='white')
d.text((70, 1048), 'pointer top left', font=small, fill=(200, 200, 205))
d.text((995, 1048), 'pointer bottom right', font=small, fill=(200, 200, 205))
sheet.save(out / 'tilt.png')


def strip(names, captions, title, file):
    """frames in a 3+2 or 2+2 grid on a 1920x1080 sheet, a caption under each"""
    sheet = Image.new('RGB', (1920, 1080), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    d.text((40, 24), title, font=big, fill='white')
    n = len(names)
    cols = 3 if n > 4 else 2
    w = (1920 - 40 * (cols + 1)) // cols
    h = w * 9 // 16
    if cols == 2:
        w, h = 760, 428
    for i, (name, cap) in enumerate(zip(names, captions)):
        r, c = divmod(i, cols)
        x = 40 + c * (w + 40) if cols == 3 else (1920 - 2 * w - 40) // 2 + c * (w + 40)
        y = 90 + r * (h + 90)
        im = Image.open(frames / f'{name}.png').resize((w, h), Image.LANCZOS)
        sheet.paste(im, (x, y))
        d.text((x, y + h + 10), cap, font=small, fill=(215, 215, 220))
    sheet.save(out / file)


strip(['enter-0', 'enter-1', 'enter-2', 'enter-3', 'enter-4'],
      ['0 ms  hotkey: a stage snapshot, sharp (no flash)',
       '~120 ms  blur rising; a glass drop appears',
       '~300 ms  the drop pours into the card',
       '~550 ms  cover fades in; swirl taking over',
       '~1.2 s  settled: swirl, clock, lyrics, controls'],
      'Enter: the desktop blurs, the album pours out of a Liquid Glass drop, the swirl takes over',
      'enter.png')
strip(['exit-0', 'exit-1', 'exit-2', 'exit-3', 'exit-4'],
      ['0 ms  click / key / chevron: input goes back at once',
       '~120 ms  content fades; the card gathers to the drop',
       '~350 ms  swirl fading into the blurred desktop',
       '~550 ms  the blur sharpens',
       '~700 ms  the desktop, usable; overlay removed'],
      'Exit: the swirl fades into the blurred desktop, then the blur sharpens',
      'exit.png')
strip(['swap-0', 'swap-1', 'swap-2', 'swap-3'],
      ['lyrics found: two columns', 'lyrics go: the column springs toward the centre',
       'the lyrics fade out, drifting right', 'settled: centred'],
      'Lyrics to no lyrics (and back, reversed): one spring for the column, the lyrics fade',
      'swap.png')
