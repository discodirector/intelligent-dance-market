#!/usr/bin/env python3
"""Build the IDM stream background loop.

  python build.py plate                 # clean background plate + Pepe matte from the Grok clips -> work/
  python quads.py                       # measure the screen glass quads on the plate -> work/quads.json
  node wall/render.cjs work/wall 1.5    # baked screen graphics (transparent PNGs, 1920x1080)
  python build.py compose               # plate + LEDs + screens + Pepe, cartoon clean-up -> out/loop-1080p24.mp4 (+720p)

Per station (the stream switches between them on a keyframe, all loops share the GOP layout):
  python build.py base                  # everything but the screens, once -> work/base-1080p24.mkv
  STATION=<key> node wall/render.cjs work/wall-<key> 1.5 && STATION=<key> PLATE=1 node wall/render.cjs work/wall-<key>
  python build.py station <key>         # -> out/loop-<key>-1080p24.mp4 (+720p)

Needs ffmpeg/ffprobe, numpy, pillow (and Playwright + Chrome for the wall render). CLEAN=0 skips clean.py. Raw clips live in src/ (clip-a/b/c.mp4, 1280x720, 24 fps, same start frame).
'station' needs only work/base-1080p24.mkv and the wall frames (no clips); STREAM_OUT=<dir> writes the loop there,
LOOP_720=0 skips the 720p copy (live/build-loops.mjs on the stream host does both).
The Grok audio track is dropped: the loop carries no audio, the stream's sound comes from the live synth.
"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean import clean  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, WORK, OUT = (os.path.join(HERE, d) for d in ("src", "work", "out"))
OUT = os.environ.get("STREAM_OUT", OUT)  # the loop builder on the stream host writes elsewhere (live/build-loops.mjs)
CLIPS = ["clip-a", "clip-b", "clip-c"]  # loop order a -> b -> c -> a
SW, SH = 1280, 720          # source frame
W, H = 1920, 1080           # output frame
FPS = 24
K = 8                       # crossfade frames at each clip join
FRAMES = 1056               # 3 x (361 - 1 - K) = 44 s = 22 bars at 120 BPM (matches wall.html)

# Pepe matte region (source px). Only motion inside it comes from the video; everything else is the plate.
PEPE_POLY = [(700, 175), (1000, 170), (1045, 250), (1045, 330), (1010, 420), (1025, 520), (900, 545),
             (740, 545), (630, 520), (640, 420), (690, 330)]
# Screen glass quads that wall.html paints over (bounding boxes, source px) - excluded from LED blinking.
SCREEN_BOXES = [(145, 108, 508, 356), (120, 0, 281, 72), (363, 33, 448, 97), (482, 67, 543, 133), (913, 50, 988, 128),
                (1030, 15, 1092, 97), (1010, 153, 1090, 225), (1155, 102, 1223, 147), (1163, 203, 1212, 230),
                (1160, 7, 1215, 62)]


def screen_boxes():
    """Bounding boxes of the measured screen quads (quads.py), falling back to SCREEN_BOXES."""
    p = os.path.join(WORK, "quads.json")
    if not os.path.exists(p):
        return SCREEN_BOXES
    import json
    return [(int(min(x for x, _ in q)), int(min(y for _, y in q)), int(max(x for x, _ in q)) + 1, int(max(y for _, y in q)) + 1)
            for q in json.load(open(p)).values()]


def screens_alpha():
    """0..1 coverage of the measured screen glass (slightly grown, soft edge), source px."""
    p = os.path.join(WORK, "quads.json")
    im = Image.new("L", (SW, SH), 0)
    if os.path.exists(p):
        import json
        d = ImageDraw.Draw(im)
        for q in json.load(open(p)).values():
            d.polygon([tuple(pt) for pt in q], fill=255)
    im = im.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
    return np.asarray(im).astype(np.float32) / 255


def frames(path, size=(SW, SH), select=None):
    vf = [f"scale={size[0]}:{size[1]}:flags=lanczos"] if size != (SW, SH) else []
    if select:
        vf.insert(0, f"select='{select}'")
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0"] + (["-vf", ",".join(vf)] if vf else []) + \
          (["-fps_mode", "passthrough"] if select else []) + ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = size[0] * size[1] * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(size[1], size[0], 3)
    p.wait()


def count(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                        "stream=nb_read_frames", "-of", "csv=p=0", path], capture_output=True, text=True)
    return int(r.stdout.strip())


def plate():
    os.makedirs(WORK, exist_ok=True)
    # Temporal median of the calmest clip (c) removes Grok's shimmering text and flicker.
    st = np.stack([f for i, f in enumerate(frames(os.path.join(SRC, "clip-c.mp4"))) if i % 3 == 0])
    Image.fromarray(np.median(st, axis=0).astype(np.uint8)).save(os.path.join(WORK, "plate.png"))
    del st
    acc = acc2 = None
    n = 0
    for c in CLIPS:
        for i, f in enumerate(frames(os.path.join(SRC, c + ".mp4"))):
            if i % 2:
                continue
            g = f.astype(np.float32).mean(2)
            if acc is None:
                acc, acc2 = np.zeros_like(g), np.zeros_like(g)
            acc += g
            acc2 += g * g
            n += 1
    std = np.sqrt(np.maximum(acc2 / n - (acc / n) ** 2, 0))
    box = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(box).polygon(PEPE_POLY, fill=255)
    m = np.minimum((std > 5).astype(np.uint8) * 255, np.asarray(box))
    im = Image.fromarray(m).filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.MaxFilter(15))
    im = Image.fromarray(np.minimum(np.asarray(im), np.asarray(box.filter(ImageFilter.MaxFilter(21)))))
    im.filter(ImageFilter.GaussianBlur(8)).save(os.path.join(WORK, "mask.png"))
    print("plate + mask ->", WORK)


def led_layer(plate_src, mask_src):
    """Per-pixel LED weight (0..1) and a blob id per pixel, at source resolution.
    Only small bright green spots that stand out from their surroundings count (not smooth desk glow)."""
    p = plate_src.astype(np.int16)
    r, g, b = p[..., 0], p[..., 1], p[..., 2]
    local = np.asarray(Image.fromarray(plate_src[..., 1]).filter(ImageFilter.GaussianBlur(6))).astype(np.int16)
    led = (g > 150) & (g - r > 60) & (g - b > 40) & (g - local > 28)
    for x0, y0, x1, y1 in screen_boxes():
        led[max(0, y0 - 4):y1 + 4, max(0, x0 - 4):x1 + 4] = False
    led &= mask_src < 0.05
    led[460:560, 450:550] = False  # mug logo
    # grow each spot a little so its halo dims with it, then label connected blobs
    grown = np.asarray(Image.fromarray(led.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
    blob = np.full((SH, SW), -1, np.int32)
    nid = 0
    for y0, x0 in zip(*np.nonzero(grown)):
        if blob[y0, x0] >= 0:
            continue
        stack = [(y0, x0)]
        blob[y0, x0] = nid
        bb = [y0, x0, y0, x0]
        while stack:
            y, x = stack.pop()
            bb = [min(bb[0], y), min(bb[1], x), max(bb[2], y), max(bb[3], x)]
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < SH and 0 <= xx < SW and grown[yy, xx] and blob[yy, xx] < 0:
                    blob[yy, xx] = nid
                    stack.append((yy, xx))
        bh, bw = bb[2] - bb[0] + 1, bb[3] - bb[1] + 1
        # indicator LEDs are small and roundish; long thin blobs are edge highlights, big ones lit panels
        if max(bh, bw) > 22 or min(bh, bw) / max(bh, bw) < 0.45:
            grown[bb[0]:bb[2] + 1, bb[1]:bb[3] + 1] &= blob[bb[0]:bb[2] + 1, bb[1]:bb[3] + 1] != nid
        nid += 1
    w = np.asarray(Image.fromarray(grown.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(1.0))) / 255.0
    # pixels of the soft edge take the id of the nearest blob pixel (via a max filter on ids)
    ids_img = Image.fromarray((np.where(grown, blob, -1) + 1).astype(np.int32), mode="I")
    near = np.asarray(ids_img.filter(ImageFilter.MaxFilter(5))).astype(np.int64) - 1
    return w.astype(np.float32), near


def led_gain(cells_unique, step):
    """Brightness multiplier per LED blob at a given 16th step (periodic in 352 steps)."""
    out = {}
    for c in cells_unique:
        h = (c * 2654435761) & 0xFFFFFFFF
        kind = h % 5
        if kind == 0:                                  # steady
            v = 1.0
        elif kind == 1:                                # blink on beats
            v = 1.0 if (step + (h >> 8) % 4) % 4 == 0 else 0.35
        elif kind == 2:                                # slow blink, 1 bar
            v = 1.0 if ((step + (h >> 8) % 16) // 8) % 2 == 0 else 0.3
        else:                                          # sparse random per step
            v = 1.0 if ((h >> 4) ^ (step * 2246822519)) % 7 < 3 else 0.4
        out[c] = v
    return out


# Final loop encode: identical GOP layout for every station (IDR every 48 frames from frame 0, closed GOPs, no
# B-frames, an access unit delimiter per frame), so the live harness can splice the raw H.264 of one station's loop
# into another's on any keyframe without a visible jump (sim/stream/live/stream.mjs).
X264 = ["-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-g", str(FPS * 2), "-keyint_min", str(FPS * 2),
        "-sc_threshold", "0", "-bf", "0", "-x264-params", "open-gop=0:aud=1", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart"]


def encode_720(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", "scale=1280:720:flags=lanczos", "-an",
                    "-crf", "19", "-maxrate", "3M", "-bufsize", "6M", *X264, dst], check=True)


def compose(with_wall=True):
    """with_wall=False ('base'): Pepe + plate + LEDs + clean-up only, near-lossless, for 'station' to dress."""
    os.makedirs(OUT, exist_ok=True)
    plate_src = np.asarray(Image.open(os.path.join(WORK, "plate.png")).convert("RGB"))
    mask_src = np.asarray(Image.open(os.path.join(WORK, "mask.png")).convert("L")).astype(np.float32) / 255
    mask_src = mask_src * (1 - screens_alpha())  # Grok flicker inside a screen must never show through
    led_src, cell_src = led_layer(plate_src, mask_src)
    up = lambda a, mode=Image.BILINEAR: np.asarray(Image.fromarray(a).resize((W, H), mode))
    CLEAN = os.environ.get("CLEAN", "1") != "0"  # cartoon clean-up of the upscaled Grok art (clean.py)
    plate_hi = np.asarray(Image.fromarray(plate_src).resize((W, H), Image.LANCZOS))
    plate_hi = (clean(plate_hi) if CLEAN else plate_hi).astype(np.float32)
    mask_hi = (up((mask_src * 255).astype(np.uint8)).astype(np.float32) / 255)[..., None]
    led_hi = (up((led_src * 255).astype(np.uint8)).astype(np.float32) / 255)
    # cell ids for LED pixels only (cheap per-frame lookup)
    ys, xs = np.nonzero(led_hi > 0.02)
    keep = cell_src[(ys * SH) // H, (xs * SW) // W] >= 0
    ys, xs = ys[keep], xs[keep]
    cid = cell_src[(ys * SH) // H, (xs * SW) // W]
    uniq, inv = np.unique(cid, return_inverse=True)
    led_w = led_hi[ys, xs][:, None]

    wall_dir = os.environ.get("WALL_DIR", os.path.join(WORK, "wall"))
    n_src = count(os.path.join(SRC, CLIPS[0] + ".mp4"))  # 361
    per = n_src - 1 - K
    assert per * len(CLIPS) == FRAMES, (per, FRAMES)

    if with_wall:
        enc_out = os.path.join(OUT, "loop-1080p24.mp4")
        rate = ["-crf", "18", "-maxrate", "6M", "-bufsize", "12M"]
    else:
        enc_out = os.path.join(WORK, "base-1080p24.mkv")
        rate = ["-crf", "8"]
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-an", *rate, *X264, enc_out], stdin=subprocess.PIPE)

    out_n = 0

    def emit(pepe):
        nonlocal out_n
        step = (out_n // 3) % 352  # 8 steps/s at 24 fps -> 3 frames per step
        g = led_gain(uniq, step)
        gains = np.array([g[c] for c in uniq], np.float32)[inv][:, None]
        base = plate_hi.copy()
        base[ys, xs] *= 1 - led_w * (1 - gains)
        if with_wall:
            wall = Image.open(os.path.join(wall_dir, f"w{out_n:04d}.png")).convert("RGBA")
            wall = wall.filter(ImageFilter.GaussianBlur(0.6))  # sit the crisp canvas into the soft upscaled art
            wa = np.asarray(wall).astype(np.float32)
            a = wa[..., 3:4] / 255
            base = base * (1 - a) + wa[..., :3] * a
        if CLEAN:
            pepe = clean(np.clip(pepe + 0.5, 0, 255).astype(np.uint8) if pepe.dtype != np.uint8 else pepe)
        o = base * (1 - mask_hi) + pepe.astype(np.float32) * mask_hi
        enc.stdin.write(np.clip(o + 0.5, 0, 255).astype(np.uint8).tobytes())
        out_n += 1

    def tail(clip):
        return [f.copy() for f in frames(os.path.join(SRC, clip + ".mp4"), (W, H),
                                         select=f"between(n\\,{n_src - 1 - K}\\,{n_src - 2})")]

    prev_tail = tail(CLIPS[-1])
    for c in CLIPS:
        buf = []
        for i, f in enumerate(frames(os.path.join(SRC, c + ".mp4"), (W, H))):
            if i < K:
                t = (i + 1) / (K + 1)
                emit(prev_tail[i].astype(np.float32) * (1 - t) + f.astype(np.float32) * t)
            elif i < n_src - 1 - K:
                emit(f)
            elif i < n_src - 1:
                buf.append(f.copy())
        prev_tail = buf
        print(c, "->", out_n, flush=True)
    enc.stdin.close()
    enc.wait()
    assert out_n == FRAMES, out_n
    if with_wall:
        encode_720(enc_out, os.path.join(OUT, "loop-720p24.mp4"))
    print("done ->", enc_out)


def station(key):
    """Dress the base with one station's screens (theme + ticker) and NOW PLAYING plate:
    node wall/render.cjs work/wall-<key> with STATION=<key> (frames) and PLATE=1 (plate.png) first."""
    wall_dir = os.path.join(WORK, f"wall-{key}")
    base = os.path.join(WORK, "base-1080p24.mkv")
    for need in (base, os.path.join(wall_dir, "plate.png"), os.path.join(wall_dir, f"w{FRAMES - 1:04d}.png")):
        if not os.path.exists(need):
            sys.exit(f"missing {need}")
    out = os.path.join(OUT, f"loop-{key}-1080p24.mp4")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", base, "-framerate", str(FPS), "-i", os.path.join(wall_dir, "w%04d.png"),
         "-i", os.path.join(wall_dir, "plate.png"),
         "-filter_complex", "[1:v]format=rgba,gblur=sigma=0.6:planes=15[w];[0:v][w]overlay=format=auto[s];[s][2:v]overlay=format=auto,format=yuv420p",
         "-frames:v", str(FRAMES), "-an", "-crf", "18", "-maxrate", "6M", "-bufsize", "12M", *X264, out], check=True)
    if os.environ.get("LOOP_720", "1") != "0":  # the stream plays the 1080p loop only
        encode_720(out, os.path.join(OUT, f"loop-{key}-720p24.mp4"))
    print("done ->", out)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "station":
        station(sys.argv[2])
    else:
        {"plate": plate, "compose": compose, "base": lambda: compose(with_wall=False)}[cmd]()
