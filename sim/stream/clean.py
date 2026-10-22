"""Cartoon clean-up for the upscaled Grok art (numpy + Pillow only).

clean(rgb_uint8) -> rgb_uint8:
  1. edge-preserving flatten (self-guided filter): smooths the AI mush in flat fills, keeps edges;
  2. ink pass: thin dark lines (black-hat of luminance) are pushed to crisp near-black;
  3. light unsharp mask.
"""
import numpy as np
from PIL import Image, ImageFilter

INK = np.array([12, 13, 11], np.float32)


def box(a, r):
    """Mean over a (2r+1)^2 window, edges clamped (cumsum)."""
    p = np.pad(a, ((r + 1, r), (r + 1, r)) + ((0, 0),) * (a.ndim - 2), mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def guided(I, r, eps):
    m = box(I, r)
    v = box(I * I, r) - m * m
    a = v / (v + eps)
    b = m - a * m
    return box(a, r) * I + box(b, r)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def ink_alpha(rgb, k=5, lo=14, hi=40):
    im = Image.fromarray(rgb)
    g = im.convert("L")
    closed = g.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    bh = np.asarray(closed).astype(np.float32) - np.asarray(g).astype(np.float32)
    # gaps between lit LEDs / meter bars are not ink lines: skip where the neighbourhood glows green
    near = np.asarray(im.filter(ImageFilter.MaxFilter(k))).astype(np.float32)
    lit = smoothstep(190, 230, near[..., 1]) * smoothstep(50, 90, near[..., 1] - near[..., 0])
    # green-drawn lines (diagram traces, dim glyphs) are not ink either: ink is near-neutral dark
    px = rgb.astype(np.float32)
    own = smoothstep(18, 40, px[..., 1] - np.maximum(px[..., 0], px[..., 2]))
    return smoothstep(lo, hi, bh) * (1 - lit) * (1 - own)


def clean(rgb, r=4, eps=0.004, ink=0.9, sharpen=0.8):
    f = rgb.astype(np.float32) / 255
    flat = guided(f, r, eps)
    a = ink_alpha(rgb)[..., None] * ink
    out = flat * 255 * (1 - a) + INK * a
    if sharpen:
        im = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
        bl = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
        out = out + sharpen * (out - bl)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)
