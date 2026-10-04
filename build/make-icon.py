"""Regenerates build/icon.png (1024), build/icon.icns and build/tray.png.

Run from the repo root:  python3 build/make-icon.py
Needs Pillow; icns packing uses macOS `iconutil`.
Colors: burgundy #9C2D3D tile, white percent sign.
"""
import math, os, subprocess, shutil
from PIL import Image, ImageDraw, ImageFilter

S = 4                      # supersample factor
N = 1024 * S
BURGUNDY = (156, 45, 61, 255)
WHITE = (255, 255, 255, 255)

def superellipse(cx, cy, half, n=4.2, steps=720):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = cx + half * math.copysign(abs(c) ** (2 / n), c)
        y = cy + half * math.copysign(abs(s) ** (2 / n), s)
        pts.append((x, y))
    return pts

def percent(draw, color, cx, cy, scale, hole):
    """Percent glyph centered at (cx, cy); scale in canvas px per unit."""
    u = scale
    # two rings
    for (dx, dy) in ((-0.30, -0.27), (0.30, 0.27)):
        x, y = cx + dx * u, cy + dy * u
        r_out, r_in = 0.20 * u, 0.088 * u
        draw.ellipse((x - r_out, y - r_out, x + r_out, y + r_out), fill=color)
        draw.ellipse((x - r_in, y - r_in, x + r_in, y + r_in), fill=hole)
    # slash with round caps
    x1, y1 = cx + 0.27 * u, cy - 0.40 * u
    x2, y2 = cx - 0.27 * u, cy + 0.40 * u
    w = 0.115 * u
    draw.line((x1, y1, x2, y2), fill=color, width=int(w))
    for (x, y) in ((x1, y1), (x2, y2)):
        draw.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)

# --- app icon -------------------------------------------------------
img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
# soft shadow (macOS icon grid: 824px tile on 1024 canvas)
shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
ImageDraw.Draw(shadow).polygon(superellipse(N / 2, N / 2 + 10 * S, 412 * S), fill=(0, 0, 0, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(14 * S))
img.alpha_composite(shadow)

tile = Image.new("RGBA", (N, N), (0, 0, 0, 0))
mask = Image.new("L", (N, N), 0)
ImageDraw.Draw(mask).polygon(superellipse(N / 2, N / 2, 412 * S), fill=255)
# vertical gradient: slightly lighter at top for depth, still #9C2D3D at center
grad = Image.new("RGBA", (N, N))
gp = grad.load()
for y in range(N):
    t = y / N
    f = 1.10 - 0.20 * t
    row = tuple(min(255, int(c * f)) for c in BURGUNDY[:3]) + (255,)
    for x in range(N):
        gp[x, y] = row
tile.paste(grad, (0, 0), mask)
glyph = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(glyph)
# ring holes must show the tile, so draw glyph then cut holes via mask
holes = Image.new("L", (N, N), 0)
glyph_mask = Image.new("L", (N, N), 0)
gm = ImageDraw.Draw(glyph_mask)
percent(gm, 255, N / 2, N / 2, 560 * S, 0)
glyph = Image.new("RGBA", (N, N), WHITE)
tile.paste(glyph, (0, 0), glyph_mask)
img.alpha_composite(tile)
icon = img.resize((1024, 1024), Image.LANCZOS)
icon.save("build/icon.png")

# --- icns -----------------------------------------------------------
iconset = "build/icon.iconset"
shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for size in (16, 32, 128, 256, 512):
    icon.resize((size, size), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}.png")
    icon.resize((size * 2, size * 2), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}@2x.png")
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", "build/icon.icns"], check=True)
shutil.rmtree(iconset)

# --- tray glyph (template image: black on transparent, 44x44 = 22pt @2x) --
# A compact filled rounded box with the percent sign knocked out of it, to
# match the other filled-box icons in the macOS menu bar (rather than a big
# bare glyph). Template images ignore color; macOS tints the opaque part and
# the knocked-out % shows the menu bar through it.
T = 44 * 16
BOX = 34 * 16                      # 17pt box inside the 22pt canvas
tray = Image.new("RGBA", (T, T), (0, 0, 0, 0))
d = ImageDraw.Draw(tray)
x0 = (T - BOX) / 2
d.rounded_rectangle((x0, x0, x0 + BOX, x0 + BOX), radius=BOX * 0.24, fill=(0, 0, 0, 255))
cut = Image.new("L", (T, T), 0)
percent(ImageDraw.Draw(cut), 255, T / 2, T / 2, BOX * 0.62, 0)
clear = Image.new("RGBA", (T, T), (0, 0, 0, 0))
tray.paste(clear, (0, 0), cut)     # erase the glyph shape from the box
tray.resize((44, 44), Image.LANCZOS).save("build/tray.png")
print("ok")
