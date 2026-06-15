from __future__ import annotations

from pathlib import Path
from random import Random

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "scare.png"

W, H = 180, 320
S = 6
SW, SH = W * S, H * S

BLACK = (0, 0, 0, 255)
WHITE = (236, 236, 232, 255)
PALE = (205, 205, 200, 255)
GRAY = (112, 112, 110, 255)
DARK = (16, 16, 16, 255)


def sc(v: float) -> int:
    return int(round(v * S))


def pts(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(sc(x), sc(y)) for x, y in points]


def polygon(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], fill) -> None:
    draw.polygon(pts(points), fill=fill)


def line(draw: ImageDraw.ImageDraw, xy: tuple[float, float, float, float], fill, width: float) -> None:
    draw.line(tuple(sc(v) for v in xy), fill=fill, width=max(1, sc(width)))


def ellipse(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], fill, outline=None, width: float = 1) -> None:
    draw.ellipse(tuple(sc(v) for v in box), fill=fill, outline=outline, width=max(1, sc(width)))


def face_shape() -> Image.Image:
    mask = Image.new("L", (SW, SH), 0)
    draw = ImageDraw.Draw(mask)

    # Human-horror face with subtle fox ears. Big, centered, and slightly cropped for impact.
    polygon(draw, [(32, 86), (54, 5), (78, 104)], 255)
    polygon(draw, [(148, 86), (126, 5), (102, 104)], 255)
    polygon(
        draw,
        [
            (46, 50), (90, 30), (134, 50), (154, 96), (153, 158),
            (144, 212), (120, 281), (90, 310), (60, 281), (36, 212),
            (27, 158), (26, 96),
        ],
        255,
    )
    return mask


def roughen_alpha(alpha: Image.Image, seed: int = 7) -> Image.Image:
    rng = Random(seed)
    noise = Image.new("L", alpha.size, 0)
    nd = ImageDraw.Draw(noise)
    for _ in range(520):
        x = rng.randrange(0, SW)
        y = rng.randrange(0, SH)
        w = rng.randrange(sc(1), sc(7))
        h = rng.randrange(sc(1), sc(12))
        val = rng.randrange(25, 110)
        nd.rectangle((x, y, x + w, y + h), fill=val)
    noise = noise.filter(ImageFilter.GaussianBlur(sc(0.5)))
    # Subtract a little noisy alpha from the edge so it feels like a rough painting.
    out = Image.new("L", alpha.size, 0)
    ap = alpha.load()
    np = noise.load()
    op = out.load()
    for y in range(alpha.height):
        for x in range(alpha.width):
            a = ap[x, y]
            if a:
                op[x, y] = max(0, min(255, a - np[x, y] // 2))
    return out


def add_shadow(base: Image.Image, alpha: Image.Image) -> None:
    shadow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    shadow_alpha = alpha.filter(ImageFilter.GaussianBlur(sc(5))).point(lambda v: min(215, v))
    shadow.putalpha(shadow_alpha)
    base.alpha_composite(shadow, (0, sc(7)))


def draw_white_face(base: Image.Image, alpha: Image.Image) -> Image.Image:
    face = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    fd = ImageDraw.Draw(face)

    fd.bitmap((0, 0), alpha, fill=WHITE)

    # Large grayscale planes only; no red, no decorative patterns.
    polygon(fd, [(34, 84), (54, 20), (69, 95), (47, 77)], fill=PALE)
    polygon(fd, [(146, 84), (126, 20), (111, 95), (133, 77)], fill=PALE)
    polygon(fd, [(38, 92), (58, 60), (55, 132), (31, 154)], fill=(178, 178, 172, 255))
    polygon(fd, [(142, 92), (122, 60), (125, 132), (149, 154)], fill=(178, 178, 172, 255))
    polygon(fd, [(53, 242), (90, 310), (127, 242), (109, 296), (90, 317), (71, 296)], fill=(186, 186, 180, 255))
    polygon(fd, [(84, 51), (90, 31), (96, 51), (94, 141), (86, 141)], fill=DARK)

    # Rough charcoal scrapes on the white surface.
    rng = Random(12)
    for _ in range(42):
        x = rng.uniform(34, 145)
        y = rng.uniform(62, 264)
        length = rng.uniform(6, 28)
        angle = rng.uniform(-1.4, 1.4)
        x2 = x + length * angle
        y2 = y + rng.uniform(2, 16)
        col = rng.choice([(70, 70, 70, 90), (0, 0, 0, 110), (255, 255, 255, 130)])
        line(fd, (x, y, x2, y2), col, rng.uniform(0.6, 1.6))

    face.putalpha(alpha)
    base.alpha_composite(face)
    return base


def draw_black_parts(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)

    # Hollow black eyes like the reference: no pupils, no shine.
    polygon(draw, [(34, 121), (78, 105), (93, 137), (72, 167), (37, 154)], fill=BLACK)
    polygon(draw, [(146, 121), (102, 105), (87, 137), (108, 167), (143, 154)], fill=BLACK)
    ellipse(draw, (38, 116, 92, 168), fill=BLACK)
    ellipse(draw, (88, 116, 142, 168), fill=BLACK)

    # Dark cheek hollows, kept black/gray only.
    polygon(draw, [(37, 166), (74, 149), (70, 178), (42, 195)], fill=(22, 22, 22, 255))
    polygon(draw, [(143, 166), (106, 149), (110, 178), (138, 195)], fill=(22, 22, 22, 255))

    # Nose bridge and black nose.
    polygon(draw, [(78, 181), (90, 163), (102, 181), (97, 193), (83, 193)], fill=BLACK)
    line(draw, (90, 192, 90, 211), BLACK, 3.5)

    # Kuchisake-onna: a long black slit from cheek to cheek with a deep mouth.
    draw.arc(tuple(sc(v) for v in (18, 154, 162, 303)), 13, 167, fill=BLACK, width=sc(18))
    line(draw, (22, 225, 178, 225), BLACK, 12)
    ellipse(draw, (20, 214, 45, 239), fill=BLACK)
    ellipse(draw, (135, 214, 160, 239), fill=BLACK)
    draw.rectangle(tuple(sc(v) for v in (46, 206, 134, 260)), fill=BLACK)

    # Teeth are cramped and irregular, like a black torn smile. Still no blood.
    top_teeth = [47, 58, 70, 82, 94, 106, 118, 129]
    for i, x in enumerate(top_teeth):
        h = 22 + (i % 3) * 4
        polygon(draw, [(x, 207), (x + 9, 207), (x + 4.5, 207 + h)], fill=WHITE)
    bottom_teeth = [54, 66, 78, 90, 102, 114]
    for i, x in enumerate(bottom_teeth):
        h = 21 + ((i + 1) % 3) * 5
        polygon(draw, [(x, 258), (x + 10, 258), (x + 5, 258 - h)], fill=WHITE)

    draw.arc(tuple(sc(v) for v in (18, 154, 162, 303)), 13, 167, fill=BLACK, width=sc(5))
    line(draw, (22, 225, 178, 225), BLACK, 3)


def draw_hands(img: Image.Image) -> None:
    # The reference has pale fists near the bottom. Add subtle fox-claw hands, not decorative.
    draw = ImageDraw.Draw(img)
    polygon(draw, [(14, 277), (42, 249), (58, 264), (35, 301)], fill=(210, 210, 204, 255))
    polygon(draw, [(166, 277), (138, 249), (122, 264), (145, 301)], fill=(210, 210, 204, 255))
    for x in [19, 27, 35]:
        line(draw, (x, 282, x + 21, 258), fill=(44, 44, 44, 255), width=2.4)
    for x in [161, 153, 145]:
        line(draw, (x, 282, x - 21, 258), fill=(44, 44, 44, 255), width=2.4)


def draw_grain(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    rng = Random(77)
    for _ in range(90):
        x = rng.randrange(0, SW)
        y = rng.randrange(0, SH)
        v = rng.choice([28, 42, 210, 236])
        a = rng.randrange(25, 95)
        draw.rectangle((x, y, x + rng.randrange(1, 4), y + rng.randrange(1, 4)), fill=(v, v, v, a))


def make_image() -> Image.Image:
    img = Image.new("RGBA", (SW, SH), BLACK)
    alpha = roughen_alpha(face_shape())
    add_shadow(img, alpha)
    draw_white_face(img, alpha)
    draw_black_parts(img)
    draw_hands(img)
    draw_grain(img)
    # Keep the background absolutely black and no text.
    out = img.resize((W, H), Image.Resampling.LANCZOS).convert("RGB")
    return out


def main() -> None:
    make_image().save(OUT, optimize=True, compress_level=9)
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
