# measure-toggle.py SHOT ORIGIN_X ORIGIN_Y "[x,y,w,h]" LABEL: a split toggle in a screenshot, from its
# pixels: the white icon circle's size and its gaps to the button's box, and the brightness across
# the box's edges (where the glass starts). Used for the system menu insets, 2026-10-20.
import sys, json
from PIL import Image
def measure(path, ox, oy, box, label):
    im = Image.open(path).convert('RGB')
    x, y, w, h = box[0]-ox, box[1]-oy, box[2], box[3]
    L = lambda px: round(sum(im.getpixel(px))/3)
    my = y + h//2
    # the white circle: in the toggle's first 44 px only
    white = [(xx, yy) for xx in range(x, x+44) for yy in range(y, y+h) if min(im.getpixel((xx, yy))) > 235]
    cx0 = min(p[0] for p in white); cx1 = max(p[0] for p in white)
    cy0 = min(p[1] for p in white); cy1 = max(p[1] for p in white)
    print(f"{label}: button box {w}x{h}; circle {cx1-cx0+1}x{cy1-cy0+1}; gaps from the box: left {cx0-x}, top {cy0-y}, bottom {y+h-1-cy1}")
    print(f"   left edge, brightness at box x-2..x+3: {[L((xx, my)) for xx in range(x-2, x+4)]}")
    print(f"   right edge, brightness at box right-3..right+2: {[L((xx, my)) for xx in range(x+w-4, x+w+2)]}")
    print(f"   top edge, brightness at box y-2..y+3: {[L((x+100, yy)) for yy in range(y-2, y+4)]}")
args = sys.argv[1:]
measure(args[0], int(args[1]), int(args[2]), json.loads(args[3]), args[4])
