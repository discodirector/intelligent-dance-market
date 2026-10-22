#!/usr/bin/env python3
"""Measure the glass quad of every screen on the plate: flood-fill the screen glass from a seed, fit a line to
each of its four edges, intersect them. Writes work/quads.json ({name: [[x,y] TL, TR, BR, BL]}, source px)
and work/quads-viz.png.  usage: python quads.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")

# name: (seed x, seed y, search box x0, y0, x1, y1) in source px
SCREENS = {
    "lcd":    (330, 240, 125, 85, 530, 375),
    "scope1": (200, 30, 105, 0, 300, 90),
    "scope2": (405, 65, 350, 25, 460, 110),
    "bars1":  (512, 100, 470, 58, 555, 145),
    "scope3": (950, 90, 900, 40, 1000, 140),
    "ring":   (1060, 57, 1020, 8, 1100, 108),
    "bars2":  (1050, 190, 995, 145, 1105, 238),
    "seg1":   (1170, 125, 1145, 92, 1235, 158),
    "seg2":   (1188, 217, 1155, 195, 1222, 240),
    "meters": (1188, 35, 1150, 0, 1228, 72),
    "scope4": (1268, 20, 1245, 0, 1280, 50),
}


DARK = {"lcd"}  # near-black glass without a green tint


# Glass that merges with a dark bezel: measured by hand on a luminance map of the plate.
MANUAL = {
    "seg1":  [[1153, 114], [1222, 103], [1222, 134], [1153, 142]],
    # top edge is above the frame: extended with the right wall's perspective (top slope steeper than the
    # bottom, right edge ~7% taller than the left), like the ring / scope3 / bars2 screens next to it
    "meters": [[1148, -3], [1221, -18.3], [1221, 57], [1148, 67]],
    "scope4": [[1255, 0], [1282, 0], [1282, 41], [1255, 44]],  # cut by the right frame edge
    "seg2":  [[1162, 206], [1211, 201], [1212, 226], [1161, 231]],
}


def glass_mask(rgb, seed, box, dark=False):
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1].astype(np.int16)
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    lum = (r + g + b) / 3
    sat = sub.max(2) - sub.min(2)
    # glass = near-black with a green tint, or green-lit content; bezels are neutral grey, ink outlines have g <= r
    ok = ((g - r >= 3) & (r < 16) & (g >= b - 2)) | ((g - r > 30) & (g > 70))
    er = 3
    if dark:  # any very dark pixel; a wider erosion cuts the thin black ink outlines around the bezel
        ok = (lum < 13) | ((g - r > 30) & (g > 70))
        er = 5
    ok = np.asarray(Image.fromarray(ok.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(er))) > 0  # cut thin bridges
    h, w = ok.shape
    sx, sy = seed[0] - x0, seed[1] - y0
    if not ok[sy, sx]:  # nudge the seed onto glass
        ys, xs = np.nonzero(ok)
        i = np.argmin((ys - sy) ** 2 + (xs - sx) ** 2)
        sy, sx = ys[i], xs[i]
    m = np.zeros_like(ok)
    stack = [(sy, sx)]
    m[sy, sx] = True
    while stack:
        y, x = stack.pop()
        for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= yy < h and 0 <= xx < w and ok[yy, xx] and not m[yy, xx]:
                m[yy, xx] = True
                stack.append((yy, xx))
    m = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(er))) > 0  # undo erosion
    # close holes (bright content inside the glass is already "ok", this just smooths)
    m = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))) > 0
    return m


def fit(ts, vs):
    """Robust line v = a*t + b: least squares, then refit on the 70% closest points."""
    ts, vs = np.asarray(ts, float), np.asarray(vs, float)
    a, b = np.polyfit(ts, vs, 1)
    for _ in range(2):
        res = np.abs(vs - (a * ts + b))
        keep = res <= np.percentile(res, 70)
        a, b = np.polyfit(ts[keep], vs[keep], 1)
    return a, b


def quad(m, box):
    x0, y0 = box[0], box[1]
    ys, xs = np.nonzero(m)
    xa, xb = np.percentile(xs, [2, 98])
    ya, yb = np.percentile(ys, [2, 98])
    cols = [x for x in range(int(xa), int(xb) + 1)]
    rows = [y for y in range(int(ya), int(yb) + 1)]
    # trim 15% at each end of an edge so rounded corners don't bend the fit
    def mid(seq):
        n = len(seq)
        return seq[int(n * 0.15): max(int(n * 0.85), int(n * 0.15) + 2)]
    top = [(x, np.nonzero(m[:, x])[0].min()) for x in mid(cols) if m[:, x].any()]
    bot = [(x, np.nonzero(m[:, x])[0].max() + 1) for x in mid(cols) if m[:, x].any()]
    lef = [(y, np.nonzero(m[y])[0].min()) for y in mid(rows) if m[y].any()]
    rig = [(y, np.nonzero(m[y])[0].max() + 1) for y in mid(rows) if m[y].any()]
    T = fit(*zip(*top)); B = fit(*zip(*bot))   # y = a x + b
    L = fit(*zip(*lef)); R = fit(*zip(*rig))   # x = a y + b

    def cross(h, v):  # y = h0 x + h1 ; x = v0 y + v1
        y = (h[0] * v[1] + h[1]) / (1 - h[0] * v[0])
        return [round(v[0] * y + v[1] + x0, 2), round(y + y0, 2)]
    return [cross(T, L), cross(T, R), cross(B, R), cross(B, L)]


def main():
    rgb = np.asarray(Image.open(os.path.join(WORK, "plate.png")).convert("RGB"))
    out = {}
    viz = Image.fromarray(rgb).resize((2560, 1440), Image.LANCZOS)
    d = ImageDraw.Draw(viz)
    for name, (sx, sy, *box) in SCREENS.items():
        if name in MANUAL:
            q, m = MANUAL[name], np.zeros((box[3] - box[1], box[2] - box[0]), bool)
        else:
            m = glass_mask(rgb, (sx, sy), box, name in DARK)
            q = [[float(round(v, 1)) for v in pt] for pt in quad(m, box)]
        out[name] = q
        mm = np.zeros(rgb.shape[:2], bool)
        mm[box[1]:box[3], box[0]:box[2]] = m
        tint = np.asarray(viz).copy()
        big = np.asarray(Image.fromarray(mm.astype(np.uint8) * 255).resize((2560, 1440))) > 127
        tint[big] = (tint[big] * 0.5 + np.array([0, 0, 255]) * 0.5).astype(np.uint8)
        viz = Image.fromarray(tint)
        d = ImageDraw.Draw(viz)
        d.polygon([(x * 2, y * 2) for x, y in q], outline=(255, 60, 60))
        d.rectangle([box[0] * 2, box[1] * 2, box[2] * 2, box[3] * 2], outline=(255, 200, 0))
        print(name, q)
    json.dump(out, open(os.path.join(WORK, "quads.json"), "w"), indent=1)
    viz.save(os.path.join(WORK, "quads-viz.png"))


if __name__ == "__main__":
    main()
