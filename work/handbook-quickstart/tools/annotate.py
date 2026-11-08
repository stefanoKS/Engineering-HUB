"""Annotate the captured screenshots for the quick start guide.

Numbers are assigned per figure and must match the numbered steps of the page where the figure is
used. Coordinates are pixel positions in the ORIGINAL capture (1440x900, or 390x844 for C01) and
were read from the actual screenshot, never guessed from a layout table.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "..", "handbook-ja", "images", "original")
DST = os.path.join(ROOT, "images")
BRAND = (173, 21, 53)

FONT_PATH = next(
    p for p in (r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\YuGothB.ttc") if os.path.exists(p)
)

CONFIG = [
    # ---- page 2: finding the project ----
    dict(
        name="fig2-1-member-projects",
        source="M05-member-projects",
        crop=(218, 55, 1440, 660),
        r=13,
        marks=[
            (1, 1185, 95, None, None),
            (2, 232, 308, None, None),
        ],
    ),
    dict(
        name="fig2-2-manager-projects",
        source="G02-manager-projects",
        crop=(218, 55, 1440, 660),
        r=13,
        marks=[
            (1, 438, 155, None, None),
            (2, 612, 155, None, None),
            (3, 1004, 155, None, None),
            (4, 232, 355, None, None),
        ],
    ),
    # ---- page 4: member creates a task ----
    dict(
        name="fig4-1-member-new-task",
        source="M04-member-create-task",
        crop=(450, 80, 990, 820),
        r=12,
        marks=[
            (1, 596, 228, 596, 244),
            (2, 884, 301, None, None),
            (3, 884, 417, None, None),
            (4, 900, 503, None, None),
            (5, 899, 750, 899, 764),
        ],
    ),
    # ---- page 5: member checks the task ----
    dict(
        name="fig5-1-member-my-work",
        source="M01-member-my-work",
        crop=(218, 55, 1440, 430),
        r=13,
        marks=[
            (1, 496, 240, 496, 252),
            (2, 1080, 226, 1080, 240),
            (3, 1280, 348, 1280, 364),
        ],
    ),
    dict(
        name="fig5-2-member-history",
        source="M07-member-history",
        crop=(230, 660, 1430, 900),
        r=13,
        marks=[
            (4, 432, 681, 400, 681),
            (5, 562, 745, 512, 745),
        ],
    ),
    # ---- page 6: manager builds the structure ----
    dict(
        name="fig6-1-manager-structure",
        source="G03-manager-project-detail",
        crop=(218, 80, 1440, 470),
        r=13,
        marks=[
            (1, 700, 229, 516, 229),
            (2, 395, 383, None, None),
            (3, 1222, 352, 1222, 368),
        ],
    ),
    # ---- page 7: manager creates a task ----
    dict(
        name="fig7-1-manager-new-task-entry",
        source="G03-manager-project-detail",
        crop=(218, 80, 1440, 500),
        r=13,
        marks=[
            (1, 1146, 148, 1146, 168),
            (2, 1306, 430, 1306, 448),
        ],
    ),
    # ---- page 8: manager edits existing work ----
    dict(
        name="fig8-1-manager-task-editor",
        source="G04-manager-task-editor",
        crop=(450, 80, 990, 820),
        r=12,
        marks=[
            (1, 884, 158, 884, 172),
            (2, 720, 265, 720, 277),
            (3, 596, 347, 596, 359),
            (4, 537, 596, 537, 620),
            (5, 936, 752, 936, 766),
        ],
    ),
    dict(
        name="fig8-2-manager-assignees",
        source="G04-manager-task-editor",
        crop=(462, 432, 980, 742),
        r=0,
        marks=[],
    ),
    # ---- page 9: timeline ----
    dict(
        name="fig9-1-manager-timeline",
        source="G06-manager-timeline",
        crop=(218, 55, 1440, 662),
        r=13,
        marks=[
            (1, 420, 202, None, None),
            (2, 240, 385, None, None),
            (3, 470, 517, 572, 517),
            (4, 557, 564, 557, 579),
            (5, 1250, 566, 1250, 584),
        ],
    ),
    # ---- page 10: member completion report ----
    dict(
        name="fig10-1-member-completion",
        source="M02-member-completion",
        crop=(440, 158, 985, 760),
        r=12,
        marks=[
            (1, 462, 256, 476, 256),
            (2, 520, 380, None, None),
            (3, 520, 508, None, None),
            (4, 905, 674, 905, 688),
            (5, 792, 674, 792, 688),
        ],
    ),
    # ---- page 11: member deadline request ----
    dict(
        name="fig11-1-member-extension",
        source="M03-member-extension",
        crop=(440, 148, 985, 760),
        r=12,
        marks=[
            (1, 462, 230, 476, 230),
            (2, 720, 371, 720, 384),
            (3, 520, 451, 520, 464),
            (4, 523, 529, 523, 542),
            (5, 905, 674, 905, 688),
        ],
    ),
    # ---- page 12: manager reviews a request ----
    dict(
        name="fig12-1-manager-requests",
        source="G08-manager-requests",
        crop=(230, 205, 1430, 470),
        r=13,
        marks=[
            (1, 380, 230, 380, 244),
            (2, 288, 288, 288, 302),
            (3, 1002, 288, 1002, 302),
            (4, 1208, 380, 1230, 380),
            (5, 1360, 323, 1360, 338),
        ],
    ),
    dict(
        name="fig12-2-manager-decision",
        source="G09-manager-decision",
        crop=(455, 165, 985, 735),
        r=12,
        marks=[
            (6, 740, 248, 740, 260),
            (7, 492, 528, None, None),
            (8, 930, 664, 930, 680),
        ],
    ),
    dict(
        name="fig12-3-manager-complete",
        source="G05-manager-task-detail",
        crop=(1085, 150, 1440, 238),
        r=12,
        marks=[
            (9, 1366, 168, 1366, 182),
        ],
    ),
    # ---- page 13: manager daily check ----
    dict(
        name="fig13-1-manager-overview",
        source="G01-manager-overview",
        crop=(218, 55, 1440, 400),
        r=13,
        marks=[
            (1, 1337, 78, None, None),
            (2, 854, 140, 854, 168),
        ],
    ),
]


def draw_marks(image: Image.Image, marks, radius: int, offset=(0, 0)) -> Image.Image:
    draw = ImageDraw.Draw(image)
    number_font = ImageFont.truetype(FONT_PATH, max(int(radius * 1.3), 10))
    ox, oy = offset
    for num, bx, by, tx, ty in marks:
        bx, by = bx - ox, by - oy
        if tx is not None:
            tx, ty = tx - ox, ty - oy
            dx, dy = tx - bx, ty - by
            length = max((dx * dx + dy * dy) ** 0.5, 1.0)
            ux, uy = dx / length, dy / length
            draw.line(
                [(bx + ux * (radius + 2), by + uy * (radius + 2)), (tx - ux * 5, ty - uy * 5)],
                fill=BRAND,
                width=2,
            )
            draw.ellipse([tx - 3, ty - 3, tx + 3, ty + 3], fill=BRAND)
        draw.ellipse(
            [bx - radius - 2, by - radius - 2, bx + radius + 2, by + radius + 2], fill=(255, 255, 255)
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
        source = Image.open(os.path.join(SRC, entry["source"] + ".png")).convert("RGB")
        offset = (0, 0)
        if entry["crop"]:
            left, top, right, bottom = entry["crop"]
            source = source.crop((left, top, min(right, source.width), min(bottom, source.height)))
            offset = (left, top)
        if entry["marks"]:
            source = draw_marks(source, entry["marks"], entry["r"], offset)
        source.save(os.path.join(DST, entry["name"] + ".png"), optimize=True)
        print("wrote", entry["name"], source.size)


if __name__ == "__main__":
    main()
