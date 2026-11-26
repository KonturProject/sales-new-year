"""Собирает картинки игры из листов Codex: python tools/pack.py [папка с заданиями]
Листы лежат вне git (тяжёлые). Результат — public/assets: маскоты, атласы Phaser, иконки страниц. Печатает сумму текстур."""
import json
import os
import sys
import numpy as np
from PIL import Image

JOBS = sys.argv[1] if len(sys.argv) > 1 else 'work/agent-exchange/jobs'
OUT = 'public/assets'
os.makedirs(OUT + '/icons', exist_ok=True)
CELL_W, CELL_H, FOOT, TALL = 288, 384, 376, 322  # ячейка маскота, линия ног, рост стоящего
total = 0.0


def sheet(job):
    d = f'{JOBS}/{job}/workspace/assets'
    files = [f for f in os.listdir(d) if f.endswith('.png')] if os.path.isdir(d) else []
    return Image.open(f'{d}/{files[0]}') if files else None


def clean(im):
    """Слабая дымка фона → 0, цвет под прозрачным — чёрный (иначе ореол при уменьшении)."""
    a = np.array(im.convert('RGBA')).astype(float)
    a[..., 3] = np.clip((a[..., 3] - 60) / 175, 0, 1) * 255
    a[a[..., 3] == 0] = 0
    return Image.fromarray(a.astype('uint8'), 'RGBA')


def bbox(im):
    return im.getchannel('A').point(lambda v: 255 if v > 90 else 0).getbbox()


def resize(im, k):
    """Уменьшение с домноженной альфой: край без тёмной каймы."""
    a = np.array(im).astype(np.float32)
    a[..., :3] *= a[..., 3:] / 255
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.array(c) for c in ch], -1)
    al = np.clip(b[..., 3:], 1e-3, 255)
    b[..., :3] = np.where(b[..., 3:] > 0.5, b[..., :3] * 255 / al, 0)
    return Image.fromarray(np.clip(b, 0, 255).astype('uint8'), 'RGBA')


def save(im, path, quality=92):
    im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=100)


def texture(im, path):
    global total
    save(im, path)
    total += im.width * im.height * 4 / 1048576
    print(f'{path}: {im.width}×{im.height}, {os.path.getsize(path) // 1024} КБ')


def grid(im, cols, rows):
    w, h = im.width / cols, im.height / rows
    return [clean(im.crop((round(c * w), round(r * h), round((c + 1) * w), round((r + 1) * h)))) for r in range(rows) for c in range(cols)]


def figure_cells(cells, per_row, stand, airborne=()):
    """Клетки фигур: единый рост по стоящей, ноги на одной линии ряда, центр головы по оси."""
    boxes = [bbox(c) for c in cells]
    k = TALL / (boxes[stand][3] - boxes[stand][1])
    out = []
    for i, c in enumerate(cells):
        row = range(i // per_row * per_row, min(len(cells), (i // per_row + 1) * per_row))
        floor = max(boxes[j][3] for j in row if j not in airborne)
        b = boxes[i]
        cut = resize(c.crop(b), k)
        y = FOOT - cut.height - (30 if i in airborne else round((floor - b[3]) * k))
        head = cut.crop((0, 0, cut.width, int(cut.height * .45)))
        hb = bbox(head) or (0, 0, cut.width, 1)
        x = max(0, min(CELL_W - cut.width, CELL_W // 2 - round((hb[0] + hb[2]) / 2)))
        cell = Image.new('RGBA', (CELL_W, CELL_H))
        if cut.width > CELL_W:
            cut = resize(cut, CELL_W / cut.width)
            y = FOOT - cut.height
        cell.alpha_composite(cut, (x, max(0, y)))
        out.append(cell)
    return out


def join(cells, cols=4):
    rows = (len(cells) + cols - 1) // cols
    im = Image.new('RGBA', (CELL_W * cols, CELL_H * rows))
    for i, c in enumerate(cells):
        im.alpha_composite(c, (i % cols * CELL_W, i // cols * CELL_H))
    return im


def atlas(name, items, width=1024):
    """items: {имя: картинка}. Полки по высоте, отступ 2 px; JSON-hash для Phaser."""
    pad, x, y, shelf, frames = 2, 0, 0, 0, {}
    placed = []
    for key, im in sorted(items.items(), key=lambda kv: -kv[1].height):
        if x + im.width + pad > width:
            x, y, shelf = 0, y + shelf + pad, 0
        placed.append((im, x, y))
        frames[key] = {'frame': {'x': x, 'y': y, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': False,
                       'spriteSourceSize': {'x': 0, 'y': 0, 'w': im.width, 'h': im.height}, 'sourceSize': {'w': im.width, 'h': im.height}}
        x += im.width + pad
        shelf = max(shelf, im.height)
    big = Image.new('RGBA', (width, y + shelf))
    for im, px, py in placed:
        big.alpha_composite(im, (px, py))
    texture(big, f'{OUT}/{name}.webp')
    json.dump({'frames': frames, 'meta': {'image': f'{name}.webp', 'size': {'w': big.width, 'h': big.height}, 'scale': '1'}},
              open(f'{OUT}/{name}.json', 'w', encoding='utf-8'), separators=(',', ':'))


def fit(im, h, w=None):
    b = bbox(im)
    cut = im.crop(b)
    return resize(cut, min(h / cut.height, (w or 10 ** 6) / cut.width, 1))


def icon(key, im, size=112):
    save(fit(im, size, size), f'{OUT}/icons/{key}.webp', 88)


# ---------------------------------------------------------------- маскоты
MASCOT = {'sr1': 'lion-sheet-001', 'sr2': 'sheet-sr2-001', 'sr3': 'sheet-sr3-001', 'sr5': 'sheet-sr5-001', 'sr6': 'sheet-sr6-001', 'sr9': 'sheet-sr9-001'}
for key, job in MASCOT.items():
    im = sheet(job)
    cells = figure_cells(grid(im, 4, 2), 4, 4, airborne=(6,))
    if key == 'sr5' and (solo := sheet('yoda-002')):
        cells[4] = figure_cells([clean(solo)], 1, 0)[0]
    if key == 'sr3' and (extra := sheet('grinch-002')):
        more = figure_cells(grid(extra, 4, 2), 4, 7)
        cells[4] = more[6]  # стоит со снежкометалкой
        cells += more
    texture(join(cells), f'{OUT}/mascot-{key}.webp')
    icon(f'mascot-{key}', cells[4], 160)
if (im := sheet('lead-001')):
    w = im.width
    raw = clean(im)
    b = bbox(raw)
    cells = figure_cells(grid(im.crop((0, max(0, b[1] - 8), w, b[3] + 8)), 4, 1), 4, 0)
    texture(join(cells), f'{OUT}/lead.webp')

# ---------------------------------------------------------------- ёлка
tree = clean(sheet('tree-001'))
texture(tree.crop(bbox(tree)), f'{OUT}/tree.webp')

# ---------------------------------------------------------------- игрушки
TOYS1 = [1, 2, 3, 7, 8, 9, 14, 15, 13, 19, 20, 21, 26, 25, 27]
TOYS2 = [4, 5, 6, 10, 11, 12, 16, 17, 18, 22, 23, 24, 28, 29, 30]
toys = {}
for job, codes in (('toys-001', TOYS1), ('toys-002', TOYS2)):
    if (im := sheet(job)):
        for code, cell in zip(codes, grid(im, 5, 3)):
            toys[f'toy-{code:02d}'] = fit(cell, 150, 150)
            icon(f'toy-{code:02d}', cell)

# ---------------------------------------------------------------- украшения
DECOR = [('decor-001', 5, 2, [201, 'garland', 206, 212, 204, 301, 302, 304, 303, 309]),
         ('decor-002', 5, 2, [202, 203, 205, 210, 211, 213, 305, 306, 307, 308]),
         ('decor-003', 2, 2, [310, 311, 312, 313])]
decor = {}
for job, cols, rows, codes in DECOR:
    if (im := sheet(job)):
        for code, cell in zip(codes, grid(im, cols, rows)):
            if code == 'garland':
                a = np.array(cell.convert('RGBA')).astype(float)
                for c, tone in ((207, (255, 214, 120)), (208, None), (209, (190, 225, 255))):
                    b = a.copy()
                    if tone:
                        g = b[..., :3].mean(-1, keepdims=True) / 255
                        b[..., :3] = np.clip(g * np.array(tone) * 1.25, 0, 255)
                    icon(f'decor-{c}', Image.fromarray(b.astype('uint8'), 'RGBA'))
                continue
            big = code in (309, 310, 311, 312, 313)
            decor[f'decor-{code}'] = fit(cell, 260 if big else 210 if code > 300 else 130, 300)
            icon(f'decor-{code}', cell)

# ---------------------------------------------------------------- предметы
PROPS = ['star', 'basket', 'post', 'bird-1', 'bird-2', 'gift-s', 'gift-m', 'gift-l', 'sock', 'lever']
SIZE = {'star': 190, 'basket': 130, 'post': 420, 'bird-1': 90, 'bird-2': 90, 'gift-s': 80, 'gift-m': 100, 'gift-l': 124, 'sock': 130, 'lever': 170}
props = {}
if (im := sheet('props-001')):
    for key, cell in zip(PROPS, grid(im, 5, 2)):
        props[key] = fit(cell, SIZE[key])
        if key.startswith('gift'):
            icon(key, cell)
if toys:
    atlas('toys', toys)
if decor or props:
    atlas('things', {**decor, **props}, 1536)

# площадь: апскейл владельца (refs/plaza-upscaled.*), иначе утверждённый вариант крыш «A» (24.11–26.11); ширина 3344 —
# столько выдерживает бюджет текстур, а наезд камеры ×2 даёт около 1,15 экранного пикселя на пиксель фона
PLAZA_W = 3344
found = sorted(f for f in os.listdir('refs') if f.startswith('plaza-upscaled')) if os.path.isdir('refs') else []
src = f'refs/{found[-1]}' if found else 'refs/plaza-roofs-A.png'
plaza = Image.open(src).convert('RGB')
small = plaza.width < PLAZA_W
plaza = plaza.resize((PLAZA_W, round(plaza.height * PLAZA_W / plaza.width)), Image.LANCZOS)
if small:
    from PIL import ImageFilter
    plaza = plaza.filter(ImageFilter.UnsharpMask(1.6, 70, 2))
plaza.save(f'{OUT}/plaza.jpg', quality=90, optimize=True, progressive=True)
print(f'площадь из {src}')
total += plaza.width * plaza.height * 4 / 1048576
print(f'площадь {plaza.width}×{plaza.height}; текстуры всего {total:.1f} МБ (бюджет 64)')
