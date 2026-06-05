#!/usr/bin/env python3
"""Create the 1200x630 Open Graph image for the game."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "_source"

SIZE = (1200, 630)
FONT_CANDIDATES = (
    "/Users/clap01/Library/Fonts/A-OTF-RyuminPro-Ultra.otf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc",
)
PIXEL_FONT_CANDIDATES = (
    "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc",
)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def pixel_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in PIXEL_FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return font(size)


def cover(image: Image.Image, size: tuple[int, int], resample: Image.Resampling) -> Image.Image:
    src = image.convert("RGB")
    sw, sh = src.size
    dw, dh = size
    scale = max(dw / sw, dh / sh)
    resized = src.resize((round(sw * scale), round(sh * scale)), resample)
    left = (resized.width - dw) // 2
    top = (resized.height - dh) // 2
    return resized.crop((left, top, left + dw, top + dh))


def contain(image: Image.Image, box: tuple[int, int], resample: Image.Resampling) -> Image.Image:
    src = image.convert("RGBA")
    scale = min(box[0] / src.width, box[1] / src.height)
    return src.resize((round(src.width * scale), round(src.height * scale)), resample)


def draw_shadowed_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    shadow: tuple[int, int, int, int] = (22, 12, 5, 210),
) -> None:
    x, y = xy
    draw.text((x + 4, y + 5), text, font=fnt, fill=shadow)
    draw.text((x, y), text, font=fnt, fill=fill)


def draw_pixel_text(
    canvas: Image.Image,
    xy: tuple[int, int],
    text: str,
    size: int,
    fill: tuple[int, int, int, int],
    shadow: tuple[int, int, int, int] = (22, 12, 5, 225),
    scale: int = 4,
    align: str = "left",
) -> None:
    small_font = pixel_font(max(1, round(size / scale)))
    probe = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    probe_draw = ImageDraw.Draw(probe)
    bbox = probe_draw.textbbox((0, 0), text, font=small_font)
    pad = 8
    small_w = bbox[2] - bbox[0] + pad * 2
    small_h = bbox[3] - bbox[1] + pad * 2
    small = Image.new("RGBA", (small_w, small_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(small)
    tx = pad - bbox[0]
    ty = pad - bbox[1]
    draw.text((tx + 2, ty + 2), text, font=small_font, fill=shadow)
    draw.text((tx, ty), text, font=small_font, fill=fill)
    pixelated = small.resize((small_w * scale, small_h * scale), Image.Resampling.NEAREST)
    x = xy[0]
    if align == "center":
        x -= pixelated.width // 2
    canvas.alpha_composite(pixelated, (x, xy[1] - pad * scale))


def main() -> None:
    bg = cover(Image.open(ASSETS / "background.png"), SIZE, Image.Resampling.NEAREST)
    bg = bg.filter(ImageFilter.GaussianBlur(0.8))
    canvas = bg.convert("RGBA")

    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle((0, 0, SIZE[0], SIZE[1]), fill=(18, 10, 5, 118))
    od.rectangle((0, 0, 700, SIZE[1]), fill=(18, 10, 5, 116))
    canvas.alpha_composite(overlay)

    # Add a warm counter-like base so the finished bowl has a grounded silhouette.
    base = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    bd = ImageDraw.Draw(base)
    bd.rectangle((0, 480, SIZE[0], SIZE[1]), fill=(105, 58, 22, 210))
    bd.rectangle((0, 480, SIZE[0], 488), fill=(219, 151, 60, 120))
    bd.rectangle((0, 548, SIZE[0], 630), fill=(68, 34, 12, 90))
    canvas.alpha_composite(base)

    bowl = contain(Image.open(SOURCE / "bowl_done.png"), (560, 500), Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((610, 500, 1060, 590), fill=(0, 0, 0, 128))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(bowl, (620, 70))

    logo = Image.open(SOURCE / "title_logo.png").convert("RGBA")
    logo = logo.resize((560, 252), Image.Resampling.NEAREST)
    canvas.alpha_composite(logo, (60, 72))

    copy_center_x = 340
    draw_pixel_text(canvas, (copy_center_x, 342), "60秒で何杯出せる？", 54, (255, 247, 216, 255), align="center")
    draw_pixel_text(canvas, (copy_center_x, 430), "冷やしたぬきタイムアタック", 40, (255, 214, 116, 255), align="center")

    # Subtle frame for social previews that crop near the edge.
    frame = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rectangle((10, 10, SIZE[0] - 11, SIZE[1] - 11), outline=(255, 238, 180, 92), width=4)
    canvas.alpha_composite(frame)

    out = ASSETS / "ogp.png"
    canvas.convert("RGB").save(out, optimize=True, compress_level=9)
    print(f"{out.relative_to(ROOT)} {SIZE[0]}x{SIZE[1]} RGB")


if __name__ == "__main__":
    main()
