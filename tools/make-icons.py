#!/usr/bin/env python3
"""Generate the PWA icons.

Not part of the site build — the site has no build step. This is a one-off
that writes icons/*.png from scratch so the artwork is reproducible and no
binary blob arrives in the repo without a source. Run it from the repo root:

    python3 tools/make-icons.py

The motif is the ledger: ascending bars, the lower part filled, and a row of
shin-signal squares underneath. Same idea as the strip on the site, at 1/40th
the width.
"""

import struct
import zlib
from pathlib import Path

INK      = (0x15, 0x24, 0x2C)   # deep slate ground
GLACIER  = (0x8F, 0xB9, 0xCC)   # planned
FROST    = (0x2C, 0x6C, 0x8C)   # logged
MOSS     = (0x3F, 0x7A, 0x52)
AMBER    = (0xB8, 0x75, 0x14)

# bar heights as a fraction of the drawing box, and each bar's shin signal
BARS = [
    (0.42, MOSS),
    (0.56, MOSS),
    (0.70, AMBER),
    (0.86, MOSS),
    (1.00, MOSS),
]
FILL = 0.55          # how much of each bar reads as logged


def write_png(path, pixels, width, height):
    """pixels: flat bytearray of RGB triples, row-major."""
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)                                   # filter type: none
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\x00"[:8].replace(b"\x00", b"\n")   # 89 50 4E 47 0D 0A 1A 0A
           + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    Path(path).write_bytes(png)
    return len(png)


class Canvas:
    def __init__(self, size, background):
        self.size = size
        self.px = bytearray(background * (size * size))

    def rect(self, x0, y0, x1, y1, colour):
        x0 = max(0, int(round(x0)))
        y0 = max(0, int(round(y0)))
        x1 = min(self.size, int(round(x1)))
        y1 = min(self.size, int(round(y1)))
        for y in range(y0, y1):
            base = (y * self.size + x0) * 3
            self.px[base:base + (x1 - x0) * 3] = bytes(colour) * (x1 - x0)


def draw(size, inset):
    """inset: fraction of the canvas kept clear on every side.
    0.08 for a normal icon, 0.22 for maskable — a maskable icon can be
    cropped to a circle, so everything that matters lives in the middle 60%."""
    c = Canvas(size, INK)
    box = size * (1 - 2 * inset)
    left = size * inset
    top = size * inset

    dot_h = box * 0.09
    gap_below = box * 0.06
    bar_zone = box - dot_h - gap_below

    slot = box / (len(BARS) + (len(BARS) - 1) * 0.34)
    gap = slot * 0.34
    baseline = top + bar_zone

    x = left
    for height_frac, signal in BARS:
        h = bar_zone * height_frac
        c.rect(x, baseline - h, x + slot, baseline, GLACIER)
        c.rect(x, baseline - h * FILL, x + slot, baseline, FROST)
        c.rect(x, baseline + gap_below, x + slot, baseline + gap_below + dot_h, signal)
        x += slot + gap

    return c


def main():
    root = Path(__file__).resolve().parent.parent
    icons = root / "icons"
    icons.mkdir(exist_ok=True)
    jobs = [
        ("icon-192.png", 192, 0.08),
        ("icon-512.png", 512, 0.08),
        ("icon-maskable-512.png", 512, 0.22),
        ("apple-touch-icon.png", 180, 0.10),
    ]
    for name, size, inset in jobs:
        c = draw(size, inset)
        n = write_png(icons / name, c.px, size, size)
        print(f"{name:26} {size:>4}px  {n:>6} bytes")


if __name__ == "__main__":
    main()
