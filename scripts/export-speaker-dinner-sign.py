# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab==5.0.1", "fonttools[woff]==4.66.1", "pypdf==6.19.0"]
# ///
"""Create the SDLCAI speakers' dinner entrance sign at true A4 size.

Run: uv run scripts/export-speaker-dinner-sign.py
Text and artwork stay vector; the page needs no bleed or borderless printer.
"""

import io
import os
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
OUTPUT = ROOT / "output/pdf/sdlcai-2026-speakers-dinner-a4.pdf"
WIDTH, HEIGHT = A4
INSET = 14 * mm
RIGHT = WIDTH - INSET
CONTENT_WIDTH = WIDTH - 2 * INSET
INK = HexColor("#0b0b0b")
SIGNAL = HexColor("#d72f2f")
WHITE = HexColor("#ffffff")
FONT_FILES = {
    "Headline": "assets/fonts/FinlandicaHeadline-Black.woff2",
    "Text": "assets/fonts/FinlandicaText-Regular.woff2",
    "Bold": "assets/fonts/FinlandicaText-Bold.woff2",
}


def register_fonts():
    for name, filename in FONT_FILES.items():
        font = FontToolsFont(ROOT / filename, recalcTimestamp=False)
        font.flavor = None
        stream = io.BytesIO()
        font.save(stream)
        stream.seek(0)
        pdfmetrics.registerFont(TTFont(name, stream))
    # assets/logo.svg specifies Arial Black; embed that same face in the mark.
    # A different platform can provide its installed font through this override.
    mark_font = Path(os.environ.get(
        "SDLCAI_MARK_FONT", "/System/Library/Fonts/Supplemental/Arial Black.ttf"
    ))
    pdfmetrics.registerFont(TTFont("Mark", str(mark_font)))


def text(pdf, label, x, baseline, font, size, color=INK, max_width=None):
    width = pdfmetrics.stringWidth(label, font, size)
    if max_width is not None and width > max_width:
        raise ValueError(f"Text exceeds its allocated space: {label}")
    if x < INSET - 0.1 or x + width > RIGHT + 0.1:
        raise ValueError(f"Text exceeds the print margins: {label}")
    pdf.setFillColor(color)
    pdf.setFont(font, size)
    pdf.drawString(x, baseline, label)


def fitted_size(label, font, width, maximum):
    return min(maximum, width / pdfmetrics.stringWidth(label, font, 1))


def logo(pdf, x, y, side):
    """Reproduce the existing two-block SDLCAI mark as vector artwork."""
    pdf.saveState()
    pdf.translate(x, y)
    scale = side / 160
    pdf.scale(scale, scale)
    pdf.setFillColor(HexColor("#f6f4ef"))
    pdf.rect(0, 0, 160, 160, stroke=0, fill=1)
    pdf.setFillColor(INK)
    pdf.rect(8, 84, 144, 68, stroke=0, fill=1)
    pdf.rect(8, 8, 144, 64, stroke=0, fill=1)
    pdf.setFillColor(HexColor("#f6f4ef"))
    for label, baseline, target_width, size in [
        ("SDLC", 103, 126, 44),
        ("AI", 21, pdfmetrics.stringWidth("AI", "Mark", 58), 58),
    ]:
        pdf.saveState()
        pdf.setFont("Mark", size)
        width = pdfmetrics.stringWidth(label, "Mark", size)
        center = 83 if label == "AI" else 80
        pdf.translate(center - target_width / 2, baseline)
        pdf.scale(target_width / width, 1)
        pdf.drawString(0, 0, label)
        pdf.restoreState()
    pdf.restoreState()


def bell(pdf, center_x, center_y):
    pdf.saveState()
    pdf.setStrokeColor(SIGNAL)
    pdf.setLineWidth(2)
    pdf.circle(center_x, center_y, 25, stroke=1, fill=0)
    pdf.setLineCap(1)
    p = pdf.beginPath()
    p.moveTo(center_x - 12, center_y - 6)
    p.curveTo(center_x - 9, center_y - 3,
              center_x - 9, center_y + 2,
              center_x - 9, center_y + 6)
    p.curveTo(center_x - 9, center_y + 18,
              center_x + 9, center_y + 18,
              center_x + 9, center_y + 6)
    p.curveTo(center_x + 9, center_y + 2,
              center_x + 9, center_y - 3,
              center_x + 12, center_y - 6)
    p.close()
    pdf.drawPath(p)
    pdf.line(center_x, center_y + 16, center_x, center_y + 18)
    pdf.arc(center_x - 4, center_y - 13, center_x + 4,
            center_y - 5, startAng=180, extent=180)
    pdf.restoreState()


def create_sign():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    pdf.setTitle("SDLCAI speakers' dinner - 12 October 2026, 17:00")
    pdf.setAuthor("SDLCAI")
    pdf.setSubject("A4 entrance sign for Donors' Lounge, staircase B")
    pdf.setFillColor(WHITE)
    pdf.rect(0, 0, WIDTH, HEIGHT, stroke=0, fill=1)

    # The entire sign fits inside 14 mm print margins.
    logo(pdf, INSET, HEIGHT - INSET - 54, 54)
    text(pdf, "SDLCAI / 2026", INSET + 69, HEIGHT - INSET - 21,
         "Bold", 17)
    text(pdf, "WELCOME", INSET + 69, HEIGHT - INSET - 45,
         "Headline", 22, SIGNAL)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(1.2)
    pdf.line(INSET, 724, RIGHT, 724)

    # Large type lets guests identify the event before approaching the door.
    title_size = fitted_size("SPEAKERS’", "Headline", CONTENT_WIDTH, 106)
    text(pdf, "SPEAKERS’", INSET, 622, "Headline", title_size)
    text(pdf, "DINNER", INSET, 518, "Headline",
         fitted_size("DINNER", "Headline", CONTENT_WIDTH, 136))
    pdf.setStrokeColor(SIGNAL)
    pdf.setLineWidth(5)
    pdf.line(INSET, 485, RIGHT, 485)

    # Date and time are equally visible, with a clear column division.
    divider = 350
    text(pdf, "MONDAY", INSET, 448, "Bold", 13)
    text(pdf, "STARTS AT", divider + 24, 448, "Bold", 13)
    text(pdf, "12.10.2026", INSET, 399, "Headline", 43,
         max_width=divider - INSET - 12)
    text(pdf, "17:00", divider + 24, 399, "Headline", 51,
         max_width=RIGHT - divider - 24)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(0.8)
    pdf.line(divider, 391, divider, 457)
    pdf.line(INSET, 371, RIGHT, 371)

    text(pdf, "DONORS’ LOUNGE", INSET, 311, "Headline", 41)
    text(pdf, "Aalto University", INSET, 278, "Bold", 21)
    text(pdf, "Computer Science building", INSET, 243, "Text", 18)
    text(pdf, "Staircase B  /  3rd floor", INSET, 217, "Bold", 20)

    pdf.setStrokeColor(INK)
    pdf.setLineWidth(1.2)
    pdf.rect(INSET, 83, CONTENT_WIDTH, 90, stroke=1, fill=0)
    bell(pdf, INSET + 43, 128)
    text(pdf, "PLEASE RING THE BUZZER", INSET + 85, 133,
         "Headline", 24, max_width=CONTENT_WIDTH - 102)
    text(pdf, "We’ll let you in.", INSET + 85, 108, "Text", 17)

    text(pdf, "sdlcai.org", INSET, INSET + 7, "Bold", 12)
    pdf.showPage()
    pdf.save()

    # Verify the delivered file, including embedded fonts and correct A4 size.
    reader = PdfReader(OUTPUT)
    if len(reader.pages) != 1:
        raise ValueError("Expected one A4 page")
    page = reader.pages[0]
    if abs(float(page.mediabox.width) - WIDTH) > 0.01:
        raise ValueError("Incorrect A4 width")
    if abs(float(page.mediabox.height) - HEIGHT) > 0.01:
        raise ValueError("Incorrect A4 height")
    extracted = page.extract_text()
    for label in ["SPEAKERS’", "DINNER", "12.10.2026", "17:00",
                  "DONORS’ LOUNGE", "Staircase B", "3rd floor",
                  "PLEASE RING THE BUZZER"]:
        if label not in extracted:
            raise ValueError(f"Missing sign text: {label}")
    fonts = page["/Resources"]["/Font"]
    for ref in fonts.values():
        font = ref.get_object()
        if "/FontDescriptor" in font:
            descriptor = font["/FontDescriptor"].get_object()
            if not any(key in descriptor for key in
                       ["/FontFile", "/FontFile2", "/FontFile3"]):
                raise ValueError("A brand font was not embedded")
    print(f"Created and verified: {OUTPUT}")


if __name__ == "__main__":
    create_sign()
