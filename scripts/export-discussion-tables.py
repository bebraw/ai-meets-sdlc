# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab==5.0.1", "fonttools[woff]==4.66.1", "pypdf==6.19.0"]
# ///
"""Export eight A4 discussion-table tents using the site's Finlandica fonts.

Run with `uv run scripts/export-discussion-tables.py`.
Each sheet has two oppositely oriented faces and a base, with two 99 mm folds.
The committed PDF is copied by the normal site build; Python is export-only.
"""

import hashlib
import io
import json
import shutil
from pathlib import Path

from fontTools.ttLib import TTFont as FontToolsFont
from pypdf import PdfReader
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site/data/discussion-tables.json"
OUTPUT = ROOT / "output/pdf/sdlcai-2026-discussion-tables.pdf"
ASSET = ROOT / "assets/slides/sdlcai-2026-discussion-tables.pdf"
MANIFEST = ROOT / "assets/slides/discussion-tables-manifest.json"
FONT_FILES = {
    "Headline": "assets/fonts/FinlandicaHeadline-Black.woff2",
    "Text": "assets/fonts/FinlandicaText-Regular.woff2",
    "Bold": "assets/fonts/FinlandicaText-Bold.woff2",
}
INK = HexColor("#0b0b0b")
MUTED = HexColor("#69645d")
WIDTH, HEIGHT = A4
PANEL = HEIGHT / 3
INSET = 12 * mm
TEXT_WIDTH = WIDTH - 2 * INSET


def register_fonts():
    for name, filename in FONT_FILES.items():
        font = FontToolsFont(ROOT / filename, recalcTimestamp=False)
        font.flavor = None
        data = io.BytesIO()
        font.save(data)
        data.seek(0)
        pdfmetrics.registerFont(TTFont(name, data))


def wrap_text(text, font, size, width):
    lines = []
    line = ""
    for word in text.split():
        if pdfmetrics.stringWidth(word, font, size) > width:
            raise ValueError(f"Word exceeds printable width: {word}")
        candidate = f"{line} {word}".strip()
        if line and pdfmetrics.stringWidth(candidate, font, size) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def validate_topics(topics):
    if len(topics) != 8 or topics[0]["title"] != "AI governance":
        raise ValueError("Expected eight topics, with AI governance first.")
    ids = set()
    talks = {
        talk["id"]
        for session in json.loads((ROOT / "site/data/schedule.json").read_text())["items"]
        for talk in session.get("talks", [])
    }
    for topic in topics:
        if topic["id"] in ids:
            raise ValueError(f"Duplicate topic ID: {topic['id']}")
        ids.add(topic["id"])
        if len(topic["titleLines"]) != 2:
            raise ValueError(f"Expected two headline lines: {topic['title']}")
        if " ".join(topic["titleLines"]).casefold() != topic["title"].casefold():
            raise ValueError(f"Print headline differs from title: {topic['title']}")
        for line in topic["titleLines"]:
            if pdfmetrics.stringWidth(line.upper(), "Headline", 60) > TEXT_WIDTH:
                raise ValueError(f"Headline exceeds printable width: {line}")
        if len(wrap_text(topic["prompt"], "Text", 17, TEXT_WIDTH)) > 2:
            raise ValueError(f"Prompt exceeds two lines: {topic['title']}")
        if not topic["sourceTalkIds"] or not set(topic["sourceTalkIds"]) <= talks:
            raise ValueError(f"Unknown program connection: {topic['title']}")


def draw_face(pdf, topic, number, count):
    pdf.setFillColor(MUTED)
    pdf.setFont("Bold", 10)
    pdf.drawString(INSET, 83 * mm, "DISCUSSION TABLE")
    pdf.drawRightString(WIDTH - INSET, 83 * mm, f"{number:02d} / {count:02d}")
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(0.6)
    pdf.line(INSET, 78 * mm, WIDTH - INSET, 78 * mm)

    pdf.setFillColor(INK)
    pdf.setFont("Headline", 60)
    for line, baseline in zip(topic["titleLines"], [57 * mm, 38 * mm]):
        pdf.drawString(INSET, baseline, line.upper())
    pdf.setFont("Text", 17)
    for index, line in enumerate(wrap_text(topic["prompt"], "Text", 17, TEXT_WIDTH)):
        pdf.drawString(INSET, 25 * mm - index * 7 * mm, line)
    pdf.setFillColor(MUTED)
    pdf.setFont("Text", 10)
    pdf.drawString(INSET, 6.5 * mm, "SDLCAI / AI meets SDLC / 13 October 2026")


def draw_base(pdf, number):
    pdf.setFillColor(MUTED)
    pdf.setFont("Bold", 10)
    pdf.drawString(INSET, 80 * mm, f"BASE PANEL / TABLE {number:02d}")
    pdf.setFont("Text", 11)
    for index, line in enumerate([
        "Print single-sided on A4 at 100% / actual size.",
        "Fold along both dashed lines to form a triangular tent.",
        "Use this panel as the base and tape the open edge underneath.",
    ]):
        pdf.drawString(INSET, 65 * mm - index * 7 * mm, line)


def verify_pdf(topics):
    document = PdfReader(OUTPUT)
    if len(document.pages) != len(topics):
        raise ValueError("PDF page count does not match the topic count.")
    for page, topic in zip(document.pages, topics):
        if abs(float(page.mediabox.width) - WIDTH) > 0.01 or abs(float(page.mediabox.height) - HEIGHT) > 0.01:
            raise ValueError("PDF page is not A4 portrait.")
        text = page.extract_text()
        for line in topic["titleLines"]:
            if text.count(line.upper()) < 2:
                raise ValueError(f"Missing second printable face: {topic['title']}")
        if "BASE PANEL" not in text:
            raise ValueError("Missing base panel.")


def main():
    register_fonts()
    topics = json.loads(SOURCE.read_text())["topics"]
    validate_topics(topics)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle("SDLCAI 2026 / Discussion tables")
    pdf.setAuthor("SDLCAI")
    pdf.setSubject("Eight A4 table tents. Single-sided, actual size. Fold at 99 and 198 mm.")
    for number, topic in enumerate(topics, start=1):
        pdf.bookmarkPage(topic["id"])
        pdf.addOutlineEntry(topic["title"], topic["id"])
        pdf.saveState()
        pdf.translate(WIDTH, HEIGHT)
        pdf.rotate(180)
        draw_face(pdf, topic, number, len(topics))
        pdf.restoreState()
        pdf.saveState()
        pdf.translate(0, PANEL)
        draw_face(pdf, topic, number, len(topics))
        pdf.restoreState()
        draw_base(pdf, number)
        pdf.setStrokeColor(HexColor("#b8b8b8"))
        pdf.setLineWidth(0.5)
        pdf.setDash(3, 3)
        for fold in [PANEL, 2 * PANEL]:
            pdf.line(5 * mm, fold, WIDTH - 5 * mm, fold)
        pdf.showPage()
    pdf.save()
    verify_pdf(topics)
    ASSET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUTPUT, ASSET)
    sources = [
        "site/data/discussion-tables.json",
        "scripts/export-discussion-tables.py",
        *FONT_FILES.values(),
    ]
    manifest = {
        "pageCount": len(topics),
        "pdf": str(ASSET.relative_to(ROOT)),
        "sha256": hashlib.sha256(ASSET.read_bytes()).hexdigest(),
        "sources": {
            filename: hashlib.sha256((ROOT / filename).read_bytes()).hexdigest()
            for filename in sources
        },
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Exported {len(topics)} A4 table tents to {OUTPUT.relative_to(ROOT)}")
    print(f"Updated protected download: {ASSET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
