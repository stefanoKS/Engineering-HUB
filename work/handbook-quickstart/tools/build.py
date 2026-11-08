"""Build the self-contained HTML and the PDF for the quick start guide.

Markdown -> HTML (python-markdown) with every image embedded as a base64 data URI, the stylesheet
inlined, then printed to PDF through the DevTools protocol so the A4 @page rules apply. Page
footers (guide title, version, date, page number) are stamped with reportlab + pypdf.
"""
from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import re
import socket
import subprocess
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
SOURCE = ROOT / "QUICKSTART_JA.md"
HTML = ROOT / "QUICKSTART_JA.html"
PDF = ROOT / "QUICKSTART_JA.pdf"
CSS = ROOT / "print.css"
BUILD = ROOT / "build"

TITLE = "設計・開発課 管理　クイックスタート"
FOOTER = "設計・開発課 管理　メンバー（MEMBER）／マネージャー（MANAGER）クイックスタート　版1.0　2026年11月7日"

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


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def inline_images(html: str) -> tuple[str, list[str]]:
    missing: list[str] = []
    used: list[str] = []

    def replace(match: re.Match[str]) -> str:
        relative = match.group(1)
        path = (ROOT / relative).resolve()
        if not path.exists():
            missing.append(relative)
            return match.group(0)
        used.append(relative)
        return f'src="{data_uri(path)}"'

    return re.sub(r'src="([^"]+)"', replace, html), missing


def build_html() -> tuple[Path, list[str], int]:
    body = markdown.markdown(
        SOURCE.read_text(encoding="utf-8"),
        extensions=["tables", "md_in_html", "attr_list", "sane_lists"],
        output_format="html5",
    )
    body = re.sub(r"<p>(?=[\u2460-\u2473])", '<p class="step">', body)
    body, missing = inline_images(body)
    css = CSS.read_text(encoding="utf-8")
    document = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITLE}</title>
<!-- Self-contained: no CDN, no external stylesheet, no JavaScript, images embedded as data URIs. -->
<style>
{css}
</style>
</head>
<body>
{body}
</body>
</html>
"""
    HTML.write_text(document, encoding="utf-8")
    return HTML, missing, len(document)


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
            connection = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=120)
            try:
                counter = 0

                def call(method: str, params: dict | None = None) -> dict:
                    nonlocal counter
                    counter += 1
                    connection.send(json.dumps({"id": counter, "method": method, "params": params or {}}))
                    while True:
                        message = json.loads(connection.recv())
                        if message.get("id") == counter:
                            if "error" in message:
                                raise SystemExit(f"{method} failed: {message['error']}")
                            return message.get("result", {})

                call("Page.enable")
                call("Page.navigate", {"url": html_path.as_uri()})
                time.sleep(2.0)
                result = call(
                    "Page.printToPDF",
                    {
                        "printBackground": True,
                        "preferCSSPageSize": True,
                        "paperWidth": 8.2677,
                        "paperHeight": 11.6929,
                        "marginTop": 0.5906,
                        "marginBottom": 0.6299,
                        "marginLeft": 0.6299,
                        "marginRight": 0.6299,
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
        raise SystemExit("PDF was not produced")


def stamp_footer(pdf_path: Path) -> int:
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    reader = PdfReader(str(pdf_path))
    total = len(reader.pages)
    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        buffer = io.BytesIO()
        overlay = canvas.Canvas(buffer, pagesize=(width, height))
        overlay.setFont("HeiseiKakuGo-W5", 7.2)
        overlay.setFillColor(HexColor("#6b7280"))
        overlay.setStrokeColor(HexColor("#dce2e8"))
        overlay.setLineWidth(0.5)
        margin = 45.0
        overlay.line(margin, 32, width - margin, 32)
        overlay.drawString(margin, 22, FOOTER)
        overlay.drawRightString(width - margin, 22, f"{index} / {total}")
        overlay.save()
        buffer.seek(0)
        page.merge_page(PdfReader(buffer).pages[0])
        writer.add_page(page)
    with open(pdf_path, "wb") as handle:
        writer.write(handle)
    return total


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    html_path, missing, size = build_html()
    print(f"HTML: {html_path.name} ({size / 1024:.0f} KB, self-contained)")
    if missing:
        print("MISSING IMAGES:", missing)
    print_pdf(html_path, PDF)
    pages = stamp_footer(PDF)
    print(f"PDF: {PDF.name} {pages} pages ({PDF.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
