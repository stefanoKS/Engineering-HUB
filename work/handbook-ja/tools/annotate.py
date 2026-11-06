"""Draw numbered click markers on the captured UI screenshots.

Coordinates are pixel positions in the ORIGINAL screenshot and come from a visual inspection of
each capture. A mark is (number, badge_x, badge_y, target_x, target_y); the target may be None when
the badge already sits beside the element. Full-page captures are cropped to the operating area so
the labels stay readable in print.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "images", "original")
DST = os.path.join(ROOT, "images")
BRAND = (173, 21, 53)

FONTS = [r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\YuGothB.ttc"]
FONT_PATH = next(p for p in FONTS if os.path.exists(p))


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


CONFIG = [
    # ---------------- member ----------------
    dict(
        id="M01-member-my-work",
        crop=(218, 55, 1440, 482),
        r=12,
        marks=[
            (1, 420, 227, 396, 227),
            (2, 1095, 300, 1095, 270),
            (3, 1193, 331, 1193, 366),
            (4, 1284, 331, 1284, 366),
        ],
    ),
    dict(
        id="M02-member-completion",
        crop=(455, 158, 985, 778),
        r=11,
        marks=[
            (1, 566, 274, 538, 274),
            (2, 634, 421, 604, 421),
            (3, 648, 549, 614, 549),
            (4, 905, 668, 905, 686),
            (5, 792, 668, 792, 686),
        ],
    ),
    dict(
        id="M03-member-extension",
        crop=(455, 148, 985, 778),
        r=11,
        marks=[
            (1, 570, 240, 540, 240),
            (2, 604, 403, 574, 403),
            (3, 596, 481, 566, 481),
            (4, 648, 555, 614, 555),
            (5, 905, 668, 905, 686),
        ],
    ),
    dict(
        id="M04-member-create-task",
        crop=(450, 80, 990, 802),
        r=11,
        marks=[
            (1, 610, 229, 578, 229),
            (2, 566, 296, 538, 296),
            (3, 596, 358, 566, 358),
            (4, 556, 504, 528, 504),
            (5, 905, 745, 905, 770),
        ],
    ),
    dict(
        id="M05-member-projects",
        crop=(218, 55, 1440, 700),
        r=12,
        marks=[
            (1, 831, 96, 831, 112),
            (2, 1240, 96, 1240, 111),
            (3, 606, 308, 505, 308),
            (4, 1240, 308, 1190, 300),
            (5, 1355, 72, 1355, 92),
        ],
    ),
    dict(
        id="M06-member-create-project",
        crop=(450, 85, 990, 800),
        r=11,
        marks=[
            (1, 610, 297, 578, 297),
            (2, 600, 362, 566, 362),
            (3, 600, 443, 568, 443),
            (4, 900, 663, 870, 663),
            (5, 890, 725, 890, 755),
        ],
    ),
    dict(
        id="M07-member-history",
        crop=(230, 660, 1430, 900),
        r=13,
        marks=[
            (1, 432, 681, 400, 681),
            (2, 562, 745, 512, 745),
            (3, 860, 801, None, None),
            (4, 856, 842, 826, 842),
        ],
    ),
    dict(
        id="C01-mobile-menu",
        crop=None,
        r=11,
        marks=[
            (1, 104, 26, 82, 26),
            (2, 152, 155, 134, 155),
            (3, 112, 239, 76, 239),
            (4, 330, 50, 352, 30),
        ],
    ),
    # ---------------- manager ----------------
    dict(
        id="G01-manager-overview",
        crop=(218, 55, 1440, 792),
        r=12,
        marks=[
            (1, 1396, 107, None, None),
            (2, 1120, 150, 1120, 167),
            (3, 246, 437, None, None),
            (4, 400, 758, 344, 758),
        ],
    ),
    dict(
        id="G02-manager-projects",
        crop=(218, 55, 1440, 700),
        r=12,
        marks=[
            (1, 400, 132, 400, 158),
            (2, 700, 132, 700, 158),
            (3, 1352, 189, 1330, 189),
            (4, 1350, 72, 1350, 92),
            (5, 606, 355, 494, 355),
        ],
    ),
    dict(
        id="G03-manager-project-detail",
        crop=(218, 80, 1440, 572),
        r=12,
        marks=[
            (1, 700, 226, 528, 226),
            (2, 424, 383, 368, 383),
            (3, 1232, 352, 1232, 368),
            (4, 1302, 500, 1342, 500),
        ],
    ),
    dict(
        id="G04-manager-task-editor",
        crop=(450, 80, 990, 815),
        r=11,
        marks=[
            (1, 884, 182, 800, 182),
            (2, 648, 255, 606, 255),
            (3, 604, 329, 580, 329),
            (4, 568, 453, 534, 453),
            (5, 736, 784, 796, 784),
        ],
    ),
    dict(
        id="G05-manager-task-detail",
        crop=(218, 80, 1440, 472),
        r=12,
        marks=[
            (1, 700, 196, 570, 196),
            (2, 1086, 385, 1046, 385),
            (3, 1088, 196, 1110, 196),
            (4, 1372, 242, 1372, 215),
        ],
    ),
    dict(
        id="G06-manager-timeline",
        crop=(218, 55, 1440, 662),
        r=12,
        marks=[
            (1, 500, 201, 412, 201),
            (2, 600, 384, 552, 384),
            (3, 900, 500, 900, 520),
            (4, 620, 586, 588, 586),
            (5, 1100, 570, 1100, 586),
        ],
    ),
    dict(
        id="G07-manager-new-project",
        crop=(420, 20, 1025, 792),
        r=11,
        marks=[
            (1, 646, 130, 552, 130),
            (2, 566, 203, 512, 203),
            (3, 604, 358, 530, 358),
            (4, 612, 433, 562, 433),
            (5, 880, 597, 800, 597),
        ],
    ),
    dict(
        id="G08-manager-requests",
        crop=(230, 205, 1430, 505),
        r=13,
        marks=[
            (1, 380, 246, None, None),
            (2, 420, 412, None, None),
            (3, 1150, 412, None, None),
            (4, 1250, 340, 1250, 366),
            (5, 1390, 308, None, None),
        ],
    ),
    dict(
        id="G09-manager-decision",
        crop=(455, 165, 985, 735),
        r=11,
        marks=[
            (1, 768, 321, 726, 321),
            (2, 790, 439, 748, 439),
            (3, 586, 558, 548, 558),
            (4, 930, 655, 930, 679),
            (5, 796, 655, 796, 679),
        ],
    ),
]


def draw_marks(image: Image.Image, marks, radius: int, offset=(0, 0)) -> Image.Image:
    draw = ImageDraw.Draw(image)
    number_font = font(int(radius * 1.3))
    ox, oy = offset
    for num, bx, by, tx, ty in marks:
        bx, by = bx - ox, by - oy
        if tx is not None:
            tx, ty = tx - ox, ty - oy
            dx, dy = tx - bx, ty - by
            length = max((dx * dx + dy * dy) ** 0.5, 1.0)
            ux, uy = dx / length, dy / length
            start = (bx + ux * (radius + 2), by + uy * (radius + 2))
            end = (tx - ux * 6, ty - uy * 6)
            draw.line([start, end], fill=BRAND, width=2)
            draw.ellipse([tx - 3, ty - 3, tx + 3, ty + 3], fill=BRAND)
        draw.ellipse(
            [bx - radius - 2, by - radius - 2, bx + radius + 2, by + radius + 2],
            fill=(255, 255, 255),
        )
        draw.ellipse([bx - radius, by - radius, bx + radius, by + radius], fill=BRAND)
        text = str(num)
        box = draw.textbbox((0, 0), text, font=number_font)
        draw.text(
            (bx - (box[2] - box[0]) / 2 - box[0], by - (box[3] - box[1]) / 2 - box[1]),
            text,
            font=number_font,
            fill=(255, 255, 255),
        )
    return image


def main() -> None:
    for entry in CONFIG:
        source = Image.open(os.path.join(SRC, entry["id"] + ".png")).convert("RGB")
        offset = (0, 0)
        if entry["crop"]:
            left, top, right, bottom = entry["crop"]
            source = source.crop((left, top, min(right, source.width), min(bottom, source.height)))
            offset = (left, top)
        source = draw_marks(source, entry["marks"], entry["r"], offset)
        source.save(os.path.join(DST, entry["id"] + ".png"), optimize=True)
        print("wrote", entry["id"], source.size)


if __name__ == "__main__":
    main()
