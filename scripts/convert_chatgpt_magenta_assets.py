#!/usr/bin/env python3
"""Convert the ChatGPT-exported magenta-background sprites to game assets.

The output keeps the source resolution intact and writes RGBA PNGs into
../assets using the file names expected by the game.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


MAGENTA = np.array([255, 0, 255], dtype=np.int32)


@dataclass(frozen=True)
class AssetSource:
    source_name: str
    output_name: str
    content: str


# Assigned by visually inspecting the generated sprites, not by game order.
ASSETS = (
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_16 (1).png",
        "bowl_done.png",
        "same patterned bowl with soba, age, tenkasu, negi, wasabi, and tsuyu",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_16 (2).png",
        "bowl_empty.png",
        "empty white bowl with indigo Japanese pattern",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_16 (3).png",
        "soba.png",
        "round bundle of brown soba noodles",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_17 (4).png",
        "tsuyu.png",
        "glossy dark-brown sauce clump with no toppings",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_17 (5).png",
        "age.png",
        "folded reddish orange-brown aburaage",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_18 (6).png",
        "tenkasu.png",
        "heap of small golden tenkasu bits",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_18 (7).png",
        "negi.png",
        "heap of green sliced scallion rings",
    ),
    AssetSource(
        "ChatGPT Image 2026年6月4日 09_24_18 (8).png",
        "wasabi.png",
        "small triangular mound of green wasabi",
    ),
)


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Remove #ff00ff backgrounds and save game-ready RGBA assets."
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path.home() / "Downloads",
        help="Directory containing the original ChatGPT Image PNG files.",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=project_root / "assets",
        help="Destination directory for converted game assets.",
    )
    parser.add_argument(
        "--bg-threshold",
        type=float,
        default=90.0,
        help="Euclidean RGB distance from #ff00ff used for the background mask.",
    )
    parser.add_argument(
        "--fringe-threshold",
        type=float,
        default=175.0,
        help="Looser magenta distance used only for 1-2px connected edge fringe.",
    )
    parser.add_argument(
        "--fringe-radius",
        type=int,
        default=2,
        help="Pixel radius around the transparent mask to remove magenta fringe.",
    )
    parser.add_argument(
        "--despill-radius",
        type=int,
        default=2,
        help="Pixel radius around the transparent mask to neutralize pink spill.",
    )
    return parser.parse_args()


def magenta_distance(rgb: np.ndarray) -> np.ndarray:
    diff = rgb.astype(np.int32) - MAGENTA
    return np.sqrt(np.sum(diff * diff, axis=2))


def remove_magenta_background(
    image: Image.Image,
    bg_threshold: float,
    fringe_threshold: float,
    fringe_radius: int,
    despill_radius: int,
) -> tuple[Image.Image, int]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8).copy()
    dist = magenta_distance(rgb)

    # The keyed backgrounds are generated as a flat magenta matte, including
    # small holes between sprite pixels, so remove close magenta anywhere.
    bg = dist <= bg_threshold

    if fringe_radius > 0:
        fringe_zone = ndi.binary_dilation(bg, iterations=fringe_radius) & ~bg
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        magenta_like = (
            (dist <= fringe_threshold)
            & (r > 140)
            & (b > 70)
            & (g < 150)
            & ((r.astype(np.int16) - g.astype(np.int16)) > 35)
            & ((b.astype(np.int16) - g.astype(np.int16)) > 25)
        )
        bg = bg | (fringe_zone & magenta_like) | magenta_like

    if despill_radius > 0:
        edge_zone = ndi.binary_dilation(bg, iterations=despill_radius) & ~bg
        r = rgb[..., 0].astype(np.int16)
        g = rgb[..., 1].astype(np.int16)
        b = rgb[..., 2].astype(np.int16)
        spill = np.maximum(0, np.minimum(r, b) - g - 8)
        spill_mask = edge_zone & (spill > 0) & (r > 90) & (b > 90)
        rgb[..., 0] = np.where(spill_mask, np.maximum(0, r - spill), r).astype(
            np.uint8
        )
        rgb[..., 2] = np.where(spill_mask, np.maximum(0, b - spill), b).astype(
            np.uint8
        )

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    rgba[bg] = np.array([0, 0, 0, 0], dtype=np.uint8)
    return Image.fromarray(rgba, mode="RGBA"), int(bg.sum())


def main() -> None:
    args = parse_args()
    args.assets_dir.mkdir(parents=True, exist_ok=True)

    for asset in ASSETS:
        src = args.source_dir / asset.source_name
        dst = args.assets_dir / asset.output_name
        if not src.exists():
            raise FileNotFoundError(f"Missing source image: {src}")

        with Image.open(src) as image:
            converted, transparent_pixels = remove_magenta_background(
                image,
                bg_threshold=args.bg_threshold,
                fringe_threshold=args.fringe_threshold,
                fringe_radius=args.fringe_radius,
                despill_radius=args.despill_radius,
            )
            converted.save(dst)

        total_pixels = converted.width * converted.height
        transparent_pct = transparent_pixels / total_pixels * 100
        print(
            f"{src.name} -> {dst.name} | {asset.content} | "
            f"{converted.width}x{converted.height} RGBA | "
            f"transparent {transparent_pct:.1f}%"
        )


if __name__ == "__main__":
    main()
