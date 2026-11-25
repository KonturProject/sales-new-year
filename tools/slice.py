"""Режет листы Codex: маскоты 4×2 (384×512, ноги на линии 500) и игрушки 5×3. python tools/slice.py mascot лист выход.png | toys лист папка"""
import sys
import numpy as np
from PIL import Image

def clean(im):
    a = np.array(im.convert('RGBA')).astype(float)
    a[..., 3] = np.clip((a[..., 3] - 60) / 175, 0, 1) * 255
    a[a[..., 3] == 0] = 0
    return Image.fromarray(a.astype('uint8'), 'RGBA')

def box(im):
    return im.getchannel('A').point(lambda v: 255 if v > 90 else 0).getbbox()

def mascot(src, out):
    s = clean(Image.open(src)); cw, ch = s.width // 4, s.height // 2
    cells = [s.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)) for r in range(2) for c in range(4)]
    boxes = [box(c) for c in cells]
    foot = [max(b[3] for b in boxes[:4]), max(boxes[i][3] for i in (4, 5, 7))]
    # рост бегущих и стоящих приводим к одному: по высоте стоящего кадра 5
    res = Image.new('RGBA', (384 * 4, 512 * 2))
    k = 430 / (boxes[4][3] - boxes[4][1])
    for i, c in enumerate(cells):
        b = boxes[i]; cut = c.crop(b); cut = cut.resize((max(1, round(cut.width * k)), max(1, round(cut.height * k))), Image.LANCZOS)
        if i == 6: y = 500 - cut.height - 40
        else: y = 500 - cut.height - round((foot[i // 4] - b[3]) * k)
        # по x держим центр головы (верхние 45 % фигуры), чтобы кадры не дёргались
        head = cut.crop((0, 0, cut.width, int(cut.height * .45))); hb = box(head) or (0, 0, cut.width, 1)
        x = 192 - round((hb[0] + hb[2]) / 2)
        x = max(0, min(384 - cut.width, x)) if cut.width <= 384 else 0
        res.alpha_composite(cut, ((i % 4) * 384 + x, (i // 4) * 512 + max(0, y)))
    res.save(out); print(out, [b[3] - b[1] for b in boxes])

def toys(src, out):
    s = clean(Image.open(src)); cw, ch = s.width / 5, s.height / 3
    for i in range(15):
        c, r = i % 5, i // 5
        cell = s.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch))); b = box(cell)
        cell.crop(b).save(f'{out}/toy-{i + 1:02d}.png')

{'mascot': mascot, 'toys': toys}[sys.argv[1]](sys.argv[2], sys.argv[3])
