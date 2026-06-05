#!/usr/bin/env python3
"""Export game-size PNG assets from assets/_source.

Source files in assets/_source are kept untouched. This script writes the
fixed-size assets used by game.js into assets/.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
SOURCE_DIR = ASSETS_DIR / "_source"


@dataclass(frozen=True)
class SpriteExport:
    source_name: str
    output_name: str
    size: tuple[int, int]
    note: str


SPRITES = (
    SpriteExport("soba.png", "soba.png", (64, 64), "soba"),
    SpriteExport("negi.png", "negi.png", (64, 64), "negi"),
    SpriteExport("wasabi.png", "wasabi.png", (48, 48), "wasabi"),
    SpriteExport("age.png", "age.png", (64, 64), "aburaage"),
    SpriteExport("tsuyu.png", "tsuyu.png", (64, 64), "tsuyu"),
    SpriteExport("tenkasu.png", "tenkasu.png", (64, 64), "tenkasu"),
    SpriteExport("bowl_empty.png", "bowl_empty.png", (96, 96), "empty bowl"),
    SpriteExport("bowl_1.png", "bowl_1.png", (96, 96), "1 topping"),
    SpriteExport("bowl_2.png", "bowl_2.png", (96, 96), "2 toppings"),
    SpriteExport("bowl_3.png", "bowl_3.png", (96, 96), "3 toppings"),
    SpriteExport("bowl_4.png", "bowl_4.png", (96, 96), "4 toppings"),
    SpriteExport("bowl_5.png", "bowl_5.png", (96, 96), "5 toppings"),
    SpriteExport("bowl_done.png", "bowl_done.png", (96, 96), "finished bowl"),
)


def resize_rgba_premultiplied(
    image: Image.Image,
    size: tuple[int, int],
    resample: Image.Resampling = Image.Resampling.LANCZOS,
) -> Image.Image:
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba, dtype=np.float32) / 255.0
    alpha = arr[..., 3]
    premultiplied = arr[..., :3] * alpha[..., None]

    resized_channels = []
    for channel in range(3):
        resized = Image.fromarray(premultiplied[..., channel], mode="F").resize(
            size, resample
        )
        resized_channels.append(np.asarray(resized, dtype=np.float32))

    resized_alpha = np.asarray(
        Image.fromarray(alpha, mode="F").resize(size, resample), dtype=np.float32
    )

    rgb = np.zeros((*size[::-1], 3), dtype=np.float32)
    safe_alpha = np.maximum(resized_alpha, 1e-6)
    for channel in range(3):
        rgb[..., channel] = resized_channels[channel] / safe_alpha

    out = np.dstack([np.clip(rgb, 0, 1), np.clip(resized_alpha, 0, 1)])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def contain_sprite(image: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    scale = min(target_size[0] / image.width, target_size[1] / image.height)
    scaled_size = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    resized = resize_rgba_premultiplied(image, scaled_size)
    canvas = Image.new("RGBA", target_size, (0, 0, 0, 0))
    offset = (
        (target_size[0] - scaled_size[0]) // 2,
        (target_size[1] - scaled_size[1]) // 2,
    )
    canvas.paste(resized, offset, resized)
    return canvas


def cover_resize_rgb(image: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    rgb = image.convert("RGB")
    src_ratio = rgb.width / rgb.height
    dst_ratio = target_size[0] / target_size[1]

    if src_ratio > dst_ratio:
        crop_w = round(rgb.height * dst_ratio)
        left = (rgb.width - crop_w) // 2
        crop = (left, 0, left + crop_w, rgb.height)
    else:
        crop_h = round(rgb.width / dst_ratio)
        top = (rgb.height - crop_h) // 2
        crop = (0, top, rgb.width, top + crop_h)

    return rgb.crop(crop).resize(target_size, Image.Resampling.LANCZOS)


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, optimize=True, compress_level=9)


def main() -> None:
    for sprite in SPRITES:
        source_path = SOURCE_DIR / sprite.source_name
        output_path = ASSETS_DIR / sprite.output_name
        if not source_path.exists():
            raise FileNotFoundError(f"Missing source image: {source_path}")

        with Image.open(source_path) as source:
            exported = contain_sprite(source, sprite.size)
        save_png(exported, output_path)
        print(
            f"{source_path.relative_to(ROOT)} -> "
            f"{output_path.relative_to(ROOT)} {sprite.size[0]}x{sprite.size[1]} "
            f"RGBA ({sprite.note})"
        )

    background_path = ASSETS_DIR / "background.png"
    if background_path.exists():
        with Image.open(background_path) as background:
            exported_bg = cover_resize_rgb(background, (180, 320))
        save_png(exported_bg, background_path)
        print("assets/background.png -> assets/background.png 180x320 RGB")
    else:
        print("assets/background.png missing; skipped background export")


if __name__ == "__main__":
    main()
