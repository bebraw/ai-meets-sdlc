# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab==5.0.1", "fonttools[woff]==4.66.1", "pypdf==6.19.0"]
# ///
"""Export A3 outdoor welcome signs in portrait and landscape, without arrows.

Run: npm run signs:export:outdoor
PDFs contain vector text and embedded brand fonts. Actual-PDF PNG exports are
300 dpi. Both layouts leave 18 mm clear around all printed content.
"""

import io
import json
import math
import shutil
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fontTools.ttLib import TTFont as FontToolsFont
from pypdf import PdfReader
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "output/pdf"
IMAGE_DIR = ROOT / "output/images"
PREVIEW_DIR = ROOT / ".cache/outdoor-signs"
INSET = 18 * mm
INK = HexColor("#0b0b0b")
SIGNAL = HexColor("#d72f2f")
ADDRESS = "Otakaari 2A, Espoo"
FONT_FILES = {
    "Headline": "assets/fonts/FinlandicaHeadline-Black.woff2",
    "Text": "assets/fonts/FinlandicaText-Regular.woff2",
    "Bold": "assets/fonts/FinlandicaText-Bold.woff2",
}


def register_fonts():
    for name, filename in FONT_FILES.items():
        font = FontToolsFont(ROOT / filename, recalcTimestamp=False)
        if font["OS/2"].fsType != 0:
            raise ValueError(f"Font does not allow unrestricted embedding: {filename}")
        font.flavor = None
        data = io.BytesIO()
        font.save(data)
        data.seek(0)
        pdfmetrics.registerFont(TTFont(name, data))


def text(pdf, label, baseline_mm, font, size, color=INK, align="left"):
    width, height = pdf._pagesize
    label_width = pdfmetrics.stringWidth(label, font, size)
    x = INSET if align == "left" else width - INSET - label_width
    baseline = baseline_mm * mm
    ascent, descent = pdfmetrics.getAscentDescent(font, size)
    if (x < INSET - 0.1 or x + label_width > width - INSET + 0.1
            or baseline + descent < INSET
            or baseline + ascent > height - INSET):
        raise ValueError(f"Text exceeds the 18 mm safe area: {label}")
    pdf.setFillColor(color)
    pdf.setFont(font, size)
    pdf.drawString(x, baseline, label)


def headline(pdf, label, baseline_mm, maximum, color=INK):
    available = pdf._pagesize[0] - 2 * INSET
    size = min(maximum, available / pdfmetrics.stringWidth(label, "Headline", 1))
    text(pdf, label, baseline_mm, "Headline", size, color)


def create_sign(filename, orientation, event):
    page_size = A3 if orientation == "portrait" else landscape(A3)
    width, height = page_size
    pdf = canvas.Canvas(str(filename), pagesize=page_size,
                        pageCompression=1, invariant=1)
    pdf.setTitle(f"{event['name']} {event['year']} / Outdoor welcome / A3 {orientation}")
    pdf.setAuthor("SDLCAI")
    pdf.setSubject(f"A3 {orientation}. Print at 100% / actual size. No arrows.")
    if orientation == "portrait":
        text(pdf, event["date"].upper(), 389, "Bold", 22)
        headline(pdf, event["name"], 316, 185)
        text(pdf, "AI meets SDLC", 292, "Text", 35)
        rule_y = 274
        headline(pdf, "WELCOME", 205, 120, SIGNAL)
        headline(pdf, event["venue"].upper(), 138, 110)
        text(pdf, event["stage"], 116, "Bold", 27)
        text(pdf, ADDRESS, 48, "Text", 29)
        text(pdf, "sdlcai.org", 26, "Bold", 27)
    else:
        text(pdf, event["date"].upper(), 265, "Bold", 22)
        headline(pdf, event["name"], 190, 260)
        text(pdf, "AI meets SDLC", 166, "Text", 36)
        rule_y = 151
        headline(pdf, "WELCOME", 105, 104, SIGNAL)
        headline(pdf, event["venue"].upper(), 63, 100)
        text(pdf, event["stage"], 45, "Bold", 27)
        text(pdf, "sdlcai.org", 24, "Bold", 26)
        text(pdf, ADDRESS, 24, "Text", 26, align="right")
    pdf.setStrokeColor(SIGNAL)
    pdf.setLineWidth(2.5 * mm)
    pdf.line(INSET, rule_y * mm, width - INSET, rule_y * mm)
    pdf.showPage()
    pdf.save()
    verify_sign(filename, page_size, event)


def verify_sign(filename, page_size, event):
    reader = PdfReader(filename)
    if len(reader.pages) != 1:
        raise ValueError("Expected a one-page sign")
    page = reader.pages[0]
    for actual, expected in zip(
        (float(page.mediabox.width), float(page.mediabox.height)), page_size
    ):
        if not math.isclose(actual, expected, abs_tol=0.01):
            raise ValueError(f"Incorrect A3 dimensions: {filename}")
    labels = [event["name"], event["date"].upper(), "AI meets SDLC", "WELCOME",
              event["venue"].upper(), event["stage"], ADDRESS, "sdlcai.org"]
    extracted = page.extract_text()
    for label in labels:
        if label not in extracted:
            raise ValueError(f"Missing sign text: {label}")
    for reference in page["/Resources"]["/Font"].values():
        font = reference.get_object()
        descriptor = font.get("/FontDescriptor")
        if descriptor and not any(
            key in descriptor.get_object() for key in ("/FontFile", "/FontFile2", "/FontFile3")
        ):
            raise ValueError(f"Font not embedded: {filename}")


def main():
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise SystemExit("Install Poppler (pdftoppm) to render the actual-PDF exports.")
    register_fonts()
    seminar = json.loads((ROOT / "site/data/seminar.json").read_text())
    event = {
        "name": seminar["name"],
        "year": seminar["date"]["iso"][:4],
        "date": seminar["date"]["display"],
        "venue": seminar["venue"]["shortName"],
        "stage": seminar["venue"]["name"].removeprefix(
            seminar["venue"]["shortName"] + " "
        ),
    }
    for directory in (PDF_DIR, IMAGE_DIR, PREVIEW_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    exports = []
    for orientation in ("portrait", "landscape"):
        stem = f"sdlcai-{event['year']}-outdoor-welcome-a3-{orientation}"
        pdf_path = PDF_DIR / f"{stem}.pdf"
        image_path = IMAGE_DIR / f"{stem}.png"
        create_sign(pdf_path, orientation, event)
        subprocess.run([renderer, "-f", "1", "-singlefile", "-r", "300", "-png",
                        str(pdf_path), str(image_path.with_suffix(""))], check=True)
        subprocess.run([renderer, "-f", "1", "-singlefile", "-scale-to", "1400", "-png",
                        str(pdf_path), str(PREVIEW_DIR / orientation)], check=True)
        exports.extend((pdf_path, image_path))
    archive = ROOT / f"output/sdlcai-{event['year']}-outdoor-signs-a3.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        for filename in exports:
            bundle.write(filename, filename.name)
        bundle.writestr("PRINTING.txt", (
            "SDLCAI outdoor welcome signs\n\n"
            "Both designs are A3 (297 x 420 mm), in portrait and landscape.\n"
            "Use the PDF for printing. Select A3 paper and 100% / actual size.\n"
            "All content stays within 18 mm print margins. No bleed is required.\n"
            "The 300 dpi PNG files are supplied for graphics and print services.\n"
            "Choose the orientation that matches your stand.\n"
        ))
    print("Exported and verified two A3 welcome signs (no arrows).")
    for filename in (*exports, archive):
        print(filename.relative_to(ROOT))


if __name__ == "__main__":
    main()
