"""Render PDF pages into contact sheets for visual review."""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build"


def contact_sheet(pdf_name: str, columns: int = 6, zoom: float = 1.0) -> Path:
    document = pymupdf.open(ROOT / pdf_name)
    thumbs = []
    for page in document:
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        thumbs.append(Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples))
    width = max(t.width for t in thumbs)
    height = max(t.height for t in thumbs)
    rows = (len(thumbs) + columns - 1) // columns
    sheet = Image.new("RGB", (width * columns, height * rows), (225, 228, 232))
    for index, image in enumerate(thumbs):
        sheet.paste(image, ((index % columns) * width, (index // columns) * height))
    path = OUT / (Path(pdf_name).stem + "-sheet.png")
    sheet.save(path)
    print(path, len(thumbs), "pages", sheet.size)
    return path


if __name__ == "__main__":
    names = sys.argv[1:] or ["HANDBOOK_JA.pdf"]
    for name in names:
        contact_sheet(name)
