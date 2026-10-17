# -*- coding: utf-8 -*-
import os, sys, fitz
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
pdf = os.path.join(BASE, "render", "面试自我介绍-haswhere.pdf")
outdir = os.path.join(BASE, "render", "pages")
os.makedirs(outdir, exist_ok=True)

doc = fitz.open(pdf)
n = doc.page_count
print("pages:", n)

imgs = []
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6))
    p = os.path.join(outdir, "p%02d.png" % (i + 1))
    pix.save(p)
    imgs.append(p)

# 拼图 3 列
cols = 3
thumb_w = 620
ims = [Image.open(p).convert("RGB") for p in imgs]
th = [im.resize((thumb_w, int(im.height * thumb_w / im.width))) for im in ims]
cell_h = max(t.height for t in th)
rows = (len(th) + cols - 1) // cols
pad = 12
W = cols * thumb_w + (cols + 1) * pad
H = rows * cell_h + (rows + 1) * pad
canvas = Image.new("RGB", (W, H), (255, 255, 255))
for idx, t in enumerate(th):
    r, c = divmod(idx, cols)
    x = pad + c * (thumb_w + pad)
    y = pad + r * (cell_h + pad)
    canvas.paste(t, (x, y))
montage = os.path.join(BASE, "render", "montage-intro.png")
canvas.save(montage)
print("montage:", montage, canvas.size)
