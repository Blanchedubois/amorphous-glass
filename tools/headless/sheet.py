import sys
from PIL import Image
out, scale, files = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
ims = [i.resize((int(i.width * scale), int(i.height * scale))) for i in ims]
cols = min(len(ims), 5)
w, h = max(i.width for i in ims), max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
o = Image.new('RGB', (cols * (w + 6), rows * (h + 6)), (255, 0, 255))
for k, im in enumerate(ims):
    o.paste(im, ((k % cols) * (w + 6), (k // cols) * (h + 6)))
o.save(out)
