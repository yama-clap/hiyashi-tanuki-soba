from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "_source"
OUT_DIR = ASSETS / "howto_slides"

# Square visual-only slides. Captions/explanations are expected to be HTML below.
W = H = 840

GOLD = (255, 213, 86)
GOLD_DARK = (184, 122, 36)
CREAM = (255, 248, 222)
BROWN = (42, 24, 12)
BROWN_2 = (69, 43, 17)
INK = (18, 10, 6)
GREEN = (106, 235, 130)
RED = (255, 84, 64)
WHITE = (255, 255, 255)


def source_path(name: str) -> Path:
    path = SOURCE / name
    return path if path.exists() else ASSETS / name


def trimmed(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def sprite(name: str, max_size: int, *, resample=Image.Resampling.LANCZOS) -> Image.Image:
    img = trimmed(Image.open(source_path(name)))
    scale = max_size / max(img.size)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, resample)


SPRITES = {
    "bowl_empty": sprite("bowl_empty.png", 390),
    "bowl_empty_small": sprite("bowl_empty.png", 230),
    "bowl_done": sprite("bowl_done.png", 420),
    "bowl_done_small": sprite("bowl_done.png", 150),
    "soba": sprite("soba.png", 210),
    "tsuyu": sprite("tsuyu.png", 190),
    "negi": sprite("negi.png", 190),
    "wasabi": sprite("wasabi.png", 170),
    "age": sprite("age.png", 190),
    "tenkasu": sprite("tenkasu.png", 190),
    "tanuki": sprite("tanuki_mask.png", 210),
    "kitsune": sprite("kitsune_mask.png", 210),
}

SMALL_FOODS = {
    "soba": sprite("soba.png", 118),
    "tsuyu": sprite("tsuyu.png", 118),
    "negi": sprite("negi.png", 118),
    "wasabi": sprite("wasabi.png", 102),
    "age": sprite("age.png", 118),
    "tenkasu": sprite("tenkasu.png", 118),
}


def paste_center(base: Image.Image, img: Image.Image, cx: int, cy: int) -> None:
    base.alpha_composite(img, (cx - img.width // 2, cy - img.height // 2))


def round_rect(draw: ImageDraw.ImageDraw, rect: tuple[int, int, int, int], fill, outline=None,
               width: int = 1, radius: int = 28) -> None:
    draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=width)


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    bg = Image.open(ASSETS / "background.png").convert("RGB")
    scaled = bg.resize((W, round(W * bg.height / bg.width)), Image.Resampling.NEAREST)
    top = max(0, (scaled.height - H) // 2)
    img = scaled.crop((0, top, W, top + H)).convert("RGBA")
    img.alpha_composite(Image.new("RGBA", (W, H), (10, 7, 8, 160)))
    draw = ImageDraw.Draw(img)
    round_rect(draw, (44, 44, W - 44, H - 44), fill=(39, 22, 12, 228), outline=GOLD, width=7, radius=34)
    round_rect(draw, (60, 60, W - 60, H - 60), fill=None, outline=(124, 82, 31), width=3, radius=24)
    return img, draw


def drop_shadow(base: Image.Image, img: Image.Image, cx: int, cy: int, blur: int = 16,
                offset: tuple[int, int] = (0, 16), alpha: int = 95) -> None:
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    a = img.getchannel("A")
    shadow.putalpha(a.filter(ImageFilter.GaussianBlur(blur)))
    tint = Image.new("RGBA", img.size, (0, 0, 0, alpha))
    tint.putalpha(shadow.getchannel("A"))
    base.alpha_composite(tint, (cx - img.width // 2 + offset[0], cy - img.height // 2 + offset[1]))
    paste_center(base, img, cx, cy)


def arrow_up(draw: ImageDraw.ImageDraw, x: int, y_top: int, y_bottom: int, color=GOLD) -> None:
    draw.line((x, y_bottom, x, y_top + 48), fill=color, width=30)
    draw.polygon([(x, y_top), (x - 76, y_top + 92), (x + 76, y_top + 92)], fill=color)
    draw.line((x + 22, y_top + 82, x + 22, y_bottom), fill=(120, 75, 18), width=8)


def arrow_down(draw: ImageDraw.ImageDraw, x: int, y_top: int, y_bottom: int, color=GOLD) -> None:
    draw.line((x, y_top, x, y_bottom - 48), fill=color, width=26)
    draw.polygon([(x, y_bottom), (x - 66, y_bottom - 86), (x + 66, y_bottom - 86)], fill=color)


def arrow_right(draw: ImageDraw.ImageDraw, x1: int, y: int, x2: int, color=GOLD_DARK) -> None:
    draw.line((x1, y, x2 - 42, y), fill=color, width=12)
    draw.polygon([(x2, y), (x2 - 56, y - 34), (x2 - 56, y + 34)], fill=color)


def draw_sparkles(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], color=GOLD) -> None:
    for x, y in points:
        draw.line((x, y - 24, x, y + 24), fill=color, width=8)
        draw.line((x - 24, y, x + 24, y), fill=color, width=8)
        draw.line((x - 13, y - 13, x + 13, y + 13), fill=color, width=4)
        draw.line((x + 13, y - 13, x - 13, y + 13), fill=color, width=4)


def draw_check(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int = 30) -> None:
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GREEN, outline=INK, width=5)
    draw.line((cx - 14, cy + 1, cx - 3, cy + 16), fill=INK, width=8)
    draw.line((cx - 3, cy + 16, cx + 21, cy - 21), fill=INK, width=8)


def draw_stop(draw: ImageDraw.ImageDraw, rect: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = rect
    draw.line((x1, y1, x2, y2), fill=RED, width=22)
    draw.line((x2, y1, x1, y2), fill=RED, width=22)


def slide01() -> Image.Image:
    img, draw = canvas()
    drop_shadow(img, SPRITES["bowl_done"], 420, 330, blur=18, offset=(0, 22), alpha=90)
    # Timer symbol.
    draw.ellipse((104, 104, 230, 230), outline=WHITE, width=12)
    draw.pieslice((104, 104, 230, 230), 270, 28, fill=(255, 255, 255, 88))
    draw.line((167, 167, 167, 118), fill=WHITE, width=11)
    draw.line((167, 167, 204, 188), fill=WHITE, width=11)
    # Multiple servings without tiny clutter.
    for x, y in [(250, 624), (420, 658), (590, 624)]:
        drop_shadow(img, SPRITES["bowl_done_small"], x, y, blur=8, offset=(0, 8), alpha=75)
    draw_sparkles(draw, [(680, 146), (704, 280), (150, 514)])
    return img.convert("RGB")


def slide02() -> Image.Image:
    img, draw = canvas()
    drop_shadow(img, SPRITES["bowl_empty"], 420, 210, blur=16, offset=(0, 16), alpha=80)
    arrow_up(draw, 420, 340, 560)
    drop_shadow(img, SPRITES["soba"], 420, 650, blur=10, offset=(0, 10), alpha=75)
    # Finger circle, placed away from the food.
    draw.ellipse((514, 616, 594, 696), fill=CREAM, outline=INK, width=6)
    for i, alpha in enumerate([130, 85, 45]):
        draw.arc((514 - i * 34, 616 + i * 20, 594 - i * 34, 696 + i * 20),
                 185, 310, fill=(255, 248, 222, alpha), width=8)
    return img.convert("RGB")


def slide03() -> Image.Image:
    img, draw = canvas()
    # Six ingredients are shown as one clean group; the exact order is described in HTML.
    items = [
        ("soba", 190, 148), ("tsuyu", 420, 148), ("negi", 650, 148),
        ("wasabi", 190, 326), ("age", 420, 326), ("tenkasu", 650, 326),
    ]
    for name, x, y in items:
        round_rect(draw, (x - 70, y - 62, x + 70, y + 62), fill=(56, 34, 15, 238),
                   outline=(143, 96, 34), width=3, radius=16)
        paste_center(img, SMALL_FOODS[name], x, y)
    arrow_down(draw, 420, 420, 520, color=GOLD)
    drop_shadow(img, SPRITES["bowl_done"], 420, 638, blur=14, offset=(0, 14), alpha=78)
    return img.convert("RGB")


def slide04() -> Image.Image:
    img, draw = canvas()
    for i in range(6):
        draw_check(draw, 160 + i * 64, 144, r=26)
    drop_shadow(img, SPRITES["bowl_done"], 330, 422, blur=16, offset=(0, 16), alpha=80)
    arrow_right(draw, 520, 392, 624, color=GOLD)
    drop_shadow(img, SPRITES["bowl_done_small"], 656, 392, blur=10, offset=(0, 10), alpha=75)
    draw.ellipse((594, 300, 748, 456), outline=GOLD, width=9)
    draw_sparkles(draw, [(676, 252), (716, 516), (170, 630)])
    return img.convert("RGB")


def slide05() -> Image.Image:
    img, draw = canvas()
    # Tanuki: positive, goes into bowl.
    round_rect(draw, (92, 96, 362, 640), fill=(58, 35, 14, 236), outline=GOLD, width=7, radius=24)
    drop_shadow(img, SPRITES["tanuki"], 227, 230, blur=10, offset=(0, 10), alpha=65)
    arrow_down(draw, 227, 320, 440, color=GOLD)
    drop_shadow(img, SPRITES["bowl_empty_small"], 227, 540, blur=10, offset=(0, 10), alpha=70)
    # Kitsune: negative, blocked.
    round_rect(draw, (478, 96, 748, 640), fill=(58, 22, 16, 236), outline=RED, width=7, radius=24)
    drop_shadow(img, SPRITES["kitsune"], 613, 285, blur=10, offset=(0, 10), alpha=65)
    draw_stop(draw, (542, 206, 686, 350))
    draw.arc((530, 454, 696, 626), 205, 335, fill=RED, width=12)
    draw.polygon([(708, 566), (650, 558), (684, 606)], fill=RED)
    draw_sparkles(draw, [(132, 706), (426, 704), (700, 706)], color=GOLD)
    return img.convert("RGB")


def slide06() -> Image.Image:
    img, draw = canvas()
    # Text-free ranking/result board.
    round_rect(draw, (158, 94, 682, 566), fill=(38, 22, 12, 248), outline=GOLD, width=8, radius=28)
    star = [(420, 134), (456, 244), (570, 244), (478, 312), (512, 424),
            (420, 356), (328, 424), (362, 312), (270, 244), (384, 244)]
    draw.polygon(star, fill=GOLD, outline=INK)
    for i, color in enumerate([GOLD, (212, 212, 212), (194, 120, 55)]):
        y = 430 + i * 54
        draw.ellipse((246, y - 22, 290, y + 22), fill=color, outline=INK, width=4)
        round_rect(draw, (320, y - 20, 582, y + 20), fill=(84, 55, 22, 238),
                   outline=(133, 88, 35), width=3, radius=9)
    round_rect(draw, (196, 620, 644, 724), fill=(71, 43, 13, 248), outline=GOLD, width=7, radius=22)
    draw.polygon([(260, 660), (260, 696), (296, 678)], fill=GOLD)
    draw.line((340, 678, 572, 678), fill=GOLD, width=13)
    return img.convert("RGB")


SLIDES = [
    ("howto_slide_01.png", slide01),
    ("howto_slide_02.png", slide02),
    ("howto_slide_03.png", slide03),
    ("howto_slide_04.png", slide04),
    ("howto_slide_05.png", slide05),
    ("howto_slide_06.png", slide06),
]


def make_preview(paths: list[Path]) -> None:
    sheet = Image.new("RGB", (420 * 2, 420 * 3), (20, 16, 22))
    for i, path in enumerate(paths):
        im = Image.open(path).convert("RGB").resize((420, 420), Image.Resampling.LANCZOS)
        sheet.paste(im, ((i % 2) * 420, (i // 2) * 420))
    sheet.save(OUT_DIR / "howto_slides_preview.png", optimize=True, compress_level=9)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for filename, draw_func in SLIDES:
        out = OUT_DIR / filename
        draw_func().save(out, optimize=True, compress_level=9)
        paths.append(out)
        print(out.relative_to(ROOT))
    make_preview(paths)
    print((OUT_DIR / "howto_slides_preview.png").relative_to(ROOT))


if __name__ == "__main__":
    main()
