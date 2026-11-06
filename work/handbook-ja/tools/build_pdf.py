"""Build the printable HTML and PDF for the Japanese handbooks.

Markdown -> HTML (python-markdown) -> PDF (headless Edge/Chrome) -> footer stamp (pypdf + reportlab).
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import markdown
import websocket
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

DOCUMENTS = [
    {
        "source": "HANDBOOK_JA.md",
        "output": "HANDBOOK_JA.pdf",
        "title": "設計・開発課 管理 操作マニュアル",
        "footer": "設計・開発課 管理　メンバー（MEMBER）・マネージャー（MANAGER）操作マニュアル　版1.0",
    },
    {
        "source": "MEMBER_QUICKSTART_JA.md",
        "output": "MEMBER_QUICKSTART_JA.pdf",
        "title": "設計・開発課 管理 メンバー（MEMBER）クイックスタート",
        "footer": "設計・開発課 管理　メンバー（MEMBER）クイックスタート　版1.0",
        "body_class": "qs",
    },
    {
        "source": "MANAGER_QUICKSTART_JA.md",
        "output": "MANAGER_QUICKSTART_JA.pdf",
        "title": "設計・開発課 管理 マネージャー（MANAGER）クイックスタート",
        "footer": "設計・開発課 管理　マネージャー（MANAGER）クイックスタート　版1.0",
        "body_class": "qs",
    },
    {
        "source": "REVIEW_CHECKLIST_JA.md",
        "output": "REVIEW_CHECKLIST_JA.pdf",
        "title": "配布前レビュー・チェックリスト",
        "footer": "配布前レビュー・チェックリスト　版1.0",
        "body_class": "review",
    },
]

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def browser() -> str:
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    raise SystemExit("No Chromium based browser found for PDF printing")


def render_html(markdown_path: Path, css: str, title: str, body_class: str = "") -> str:
    text = markdown_path.read_text(encoding="utf-8")
    body = markdown.markdown(
        text,
        extensions=["tables", "md_in_html", "attr_list", "sane_lists"],
        output_format="html5",
    )
    body = re.sub(r'<figure>\s*(<img[^>]*class="portrait")', r'<figure class="side">\1', body)
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="{ROOT.as_uri()}/">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body class="{body_class}">
{body}
</body>
</html>
"""


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_devtools(port: int, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
                json.loads(response.read())
            return
        except Exception:
            time.sleep(0.3)
    raise SystemExit("DevTools endpoint did not start")


def print_pdf(html_path: Path, pdf_path: Path) -> None:
    """Print through the DevTools protocol so the CSS @page size (A4) is honoured."""
    port = free_port()
    with tempfile.TemporaryDirectory() as profile:
        process = subprocess.Popen(
            [
                browser(),
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={profile}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_for_devtools(port)
            request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
            with urllib.request.urlopen(request, timeout=10) as response:
                target = json.loads(response.read())
            connection = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=60)
            try:
                message_id = 0

                def call(method: str, params: dict | None = None) -> dict:
                    nonlocal message_id
                    message_id += 1
                    connection.send(json.dumps({"id": message_id, "method": method, "params": params or {}}))
                    while True:
                        message = json.loads(connection.recv())
                        if message.get("id") == message_id:
                            if "error" in message:
                                raise SystemExit(f"{method} failed: {message['error']}")
                            return message.get("result", {})

                call("Page.enable")
                call("Page.navigate", {"url": html_path.as_uri()})
                time.sleep(1.5)
                result = call(
                    "Page.printToPDF",
                    {
                        "printBackground": True,
                        "preferCSSPageSize": True,
                        "paperWidth": 8.2677,
                        "paperHeight": 11.6929,
                        "marginTop": 0.5906,
                        "marginBottom": 0.5906,
                        "marginLeft": 0.5906,
                        "marginRight": 0.5906,
                    },
                )
                pdf_path.write_bytes(base64.b64decode(result["data"]))
            finally:
                connection.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
    if not pdf_path.exists():
        raise SystemExit(f"PDF was not produced for {html_path.name}")


def stamp_footer(pdf_path: Path, footer: str) -> int:
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    reader = PdfReader(str(pdf_path))
    total = len(reader.pages)
    writer = PdfWriter()

    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        buffer = io.BytesIO()
        overlay = canvas.Canvas(buffer, pagesize=(width, height))
        overlay.setFont("HeiseiKakuGo-W5", 7.5)
        overlay.setFillColor(HexColor("#6b7280"))
        overlay.setStrokeColor(HexColor("#dce2e8"))
        overlay.setLineWidth(0.5)
        margin = 42.5
        overlay.line(margin, 34, width - margin, 34)
        overlay.drawString(margin, 24, footer)
        overlay.drawRightString(width - margin, 24, f"{index} / {total}")
        overlay.save()
        buffer.seek(0)
        page.merge_page(PdfReader(buffer).pages[0])
        writer.add_page(page)

    with open(pdf_path, "wb") as handle:
        writer.write(handle)
    return total


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    css = (ROOT / "print.css").read_text(encoding="utf-8")
    only = sys.argv[1:] or None

    for document in DOCUMENTS:
        if only and document["output"] not in only:
            continue
        source = ROOT / document["source"]
        html_path = BUILD / (source.stem + ".html")
        html_path.write_text(
            render_html(source, css, document["title"], document.get("body_class", "")), encoding="utf-8"
        )
        pdf_path = ROOT / document["output"]
        print_pdf(html_path, pdf_path)
        pages = stamp_footer(pdf_path, document["footer"])
        print(f"{document['output']}: {pages} pages, {pdf_path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
