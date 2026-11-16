# 把几张截图横着拼成一张，方便一起看：python3 dev/montage.py 输出.png 图1 图2 ...
import sys
from PIL import Image
out, files = sys.argv[1], sys.argv[2:]
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    if im.height > 1500:                      # 太长的切成两段
        ims.append(im.crop((0, 0, im.width, 1500)))
        ims.append(im.crop((0, 1500, im.width, min(im.height, 3000))))
    else:
        ims.append(im)
gap = 16
W = sum(i.width for i in ims) + gap * (len(ims) + 1)
H = max(i.height for i in ims) + gap * 2
sheet = Image.new('RGB', (W, H), (120, 124, 132))
x = gap
for i in ims:
    sheet.paste(i, (x, gap)); x += i.width + gap
sheet.save(out)
print(out, sheet.size)
