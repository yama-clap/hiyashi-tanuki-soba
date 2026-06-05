#!/usr/bin/env python3
"""Create the transparent title logo used by the title screen."""

from __future__ import annotations

from pathlib import Path
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "_source"
FONT = "/Users/clap01/Library/Fonts/A-OTF-RyuminPro-Ultra.otf"
FONT_INDEX = 0

SOURCE_SIZE = (320, 144)
OUTPUT_SIZE = (160, 72)
TEXT_LINES = ("一分の", "冷やしたぬき")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=FONT_INDEX)


def centered_text(draw: ImageDraw.ImageDraw, text: str, y: int, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=fnt, stroke_width=0)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (SOURCE_SIZE[0] - w) // 2
    return x, y - h // 2


def add_ink_texture(alpha: Image.Image) -> Image.Image:
    rng = random.Random(20260604)
    arr = np.asarray(alpha, dtype=np.uint8).copy()
    h, w = arr.shape

    # Soft vertical dry-brush streaks inside the strokes.
    for _ in range(850):
        x = rng.randrange(w)
        y = rng.randrange(h)
        length = rng.randrange(1, 7)
        if arr[y, x] > 75 and rng.random() < 0.34:
            arr[y : min(h, y + length), x] = (arr[y : min(h, y + length), x] * rng.uniform(0.56, 0.84)).astype(np.uint8)

    # Small chips and rough edges.
    noise = np.asarray(Image.effect_noise((w, h), 56), dtype=np.float32)
    chip = (noise > 34) & (arr > 70)
    arr[chip] = (arr[chip] * 0.72).astype(np.uint8)
    return Image.fromarray(arr, "L")


def make_logo(size: tuple[int, int]) -> Image.Image:
    base = Image.new("RGBA", SOURCE_SIZE, (0, 0, 0, 0))
    mask = Image.new("L", SOURCE_SIZE, 0)
    draw = ImageDraw.Draw(mask)

    f1 = font(43)
    f2 = font(36)
    x1, y1 = centered_text(draw, TEXT_LINES[0], 39, f1)
    x2, y2 = centered_text(draw, TEXT_LINES[1], 94, f2)

    # The font itself is already very heavy; a single stroked pass keeps the
    # brush weight while preserving kana counters at the final 160x72 size.
    draw.text((x1, y1), TEXT_LINES[0], font=f1, fill=242, stroke_width=1, stroke_fill=242)
    draw.text((x2, y2), TEXT_LINES[1], font=f2, fill=250, stroke_width=1, stroke_fill=250)

    mask = add_ink_texture(mask.filter(ImageFilter.GaussianBlur(0.2)))
    outline = mask.filter(ImageFilter.MaxFilter(7))
    outline = outline.filter(ImageFilter.GaussianBlur(0.45))
    shadow = ImageChops.offset(outline, 3, 4).filter(ImageFilter.GaussianBlur(0.8))

    # Shadow, dark rim, and white ink fill for readability on the warm shop
    # background while keeping the thick calligraphy silhouette.
    base.alpha_composite(Image.merge("RGBA", [
        Image.new("L", SOURCE_SIZE, 10),
        Image.new("L", SOURCE_SIZE, 7),
        Image.new("L", SOURCE_SIZE, 5),
        shadow.point(lambda v: min(175, int(v * 0.72))),
    ]))
    base.alpha_composite(Image.merge("RGBA", [
        Image.new("L", SOURCE_SIZE, 24),
        Image.new("L", SOURCE_SIZE, 16),
        Image.new("L", SOURCE_SIZE, 8),
        outline.point(lambda v: min(250, int(v * 1.05))),
    ]))
    base.alpha_composite(Image.merge("RGBA", [
        Image.new("L", SOURCE_SIZE, 255),
        Image.new("L", SOURCE_SIZE, 255),
        Image.new("L", SOURCE_SIZE, 246),
        mask.point(lambda v: min(255, int(v * 1.5))),
    ]))

    highlight = ImageChops.offset(mask, -2, -2).filter(ImageFilter.GaussianBlur(0.4))
    base.alpha_composite(Image.merge("RGBA", [
        Image.new("L", SOURCE_SIZE, 255),
        Image.new("L", SOURCE_SIZE, 255),
        Image.new("L", SOURCE_SIZE, 255),
        highlight.point(lambda v: min(70, int(v * 0.2))),
    ]))

    # A few square ink flecks keep it in the retro pixel-art family.
    flecks = ImageDraw.Draw(base)
    rng = random.Random(72)
    for _ in range(70):
        x = rng.randrange(14, SOURCE_SIZE[0] - 14)
        y = rng.randrange(18, SOURCE_SIZE[1] - 10)
        if mask.getpixel((x, y)) > 20:
            flecks.rectangle((x, y, x + rng.randrange(1, 3), y + rng.randrange(1, 3)), fill=(55, 32, 14, rng.randrange(55, 120)))

    if size == SOURCE_SIZE:
        return base
    return base.resize(size, Image.Resampling.NEAREST)


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    source_logo = make_logo(SOURCE_SIZE)
    output_logo = make_logo(OUTPUT_SIZE)
    source_logo.save(SOURCE / "title_logo.png", optimize=True, compress_level=9)
    output_logo.save(ASSETS / "title_logo.png", optimize=True, compress_level=9)
    print(f"assets/_source/title_logo.png {SOURCE_SIZE[0]}x{SOURCE_SIZE[1]} RGBA")
    print(f"assets/title_logo.png {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]} RGBA")


if __name__ == "__main__":
    main()
