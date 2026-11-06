"""Insert page numbers into the handbook table of contents.

Two passes: read the page of every chapter heading from the finished PDF, write the numbers into
the Markdown table, rebuild, then confirm the page numbers did not move.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
MD = ROOT / "HANDBOOK_JA.md"
PDF = ROOT / "HANDBOOK_JA.pdf"
ROW = re.compile(r"^\| [^|]+ \| (第\d+章[^|]*) \|$")


def chapter_pages() -> dict[int, int]:
    document = pymupdf.open(PDF)
    pages: dict[int, int] = {}
    for number, page in enumerate(document, start=1):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"]).strip()
                size = max((span["size"] for span in line["spans"]), default=0)
                match = re.match(r"^第(\d+)章", text)
                if match and size >= 13:
                    pages.setdefault(int(match.group(1)), number)
    return pages


def build() -> None:
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_pdf.py"), "HANDBOOK_JA.pdf"],
        check=True,
        cwd=ROOT,
    )


def main() -> None:
    pages = chapter_pages()
    text = MD.read_text(encoding="utf-8")
    lines = text.split("\n")
    changed = False

    for index, line in enumerate(lines):
        match = ROW.match(line)
        if not match:
            continue
        cell = re.sub(r"（p\.\d+）", "", match.group(1))
        single = re.match(r"^(第\d+章) (.+)$", cell)
        if single:
            chapter = int(re.search(r"\d+", single.group(1)).group())
            page = pages.get(chapter)
            if page:
                new_cell = f"{single.group(1)} {single.group(2)}（p.{page}）"
                lines[index] = f"| {line.split(' | ')[0][2:]} | {new_cell} |"
                changed = True
            continue
        new_cell = cell
        for number in re.findall(r"第(\d+)章", cell):
            page = pages.get(int(number))
            if page:
                new_cell = new_cell.replace(f"第{number}章", f"第{number}章（p.{page}）")
        if new_cell != cell:
            lines[index] = f"| {line.split(' | ')[0][2:]} | {new_cell} |"
            changed = True

    if not changed:
        print("TOC already numbered")
        return

    MD.write_text("\n".join(lines), encoding="utf-8")
    build()
    after = chapter_pages()
    if after != pages:
        print("WARNING: pagination moved after inserting page numbers")
        print("before", pages)
        print("after ", after)
    else:
        print("TOC page numbers inserted and verified:", pages)


if __name__ == "__main__":
    main()
