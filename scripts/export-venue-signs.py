# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab==5.0.1", "fonttools[woff]==4.66.1", "pypdf==6.19.0"]
# ///
"""Export seven A4 venue signs, individual PDFs, and an organizer print pack.

Run: npm run signs:export
Requires Poppler's pdftoppm for the actual-PDF previews. Text, arrows, and QR
codes are vector artwork; the site's Finlandica fonts are embedded in each PDF.
The normal site build serves committed assets and requires no PDF tooling.
"""

import hashlib
import io
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

from fontTools.ttLib import TTFont as FontToolsFont
from pypdf import PdfReader
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site/data/venue-signs.json"
ASSET_DIR = ROOT / "assets/slides/venue-signs"
OUTPUT_DIR = ROOT / "output/pdf/venue-signs"
PACK = ROOT / "output/pdf/sdlcai-2026-venue-signs-a4.pdf"
PACK_ASSET = ROOT / "assets/slides/sdlcai-2026-venue-signs-a4.pdf"
MANIFEST = ROOT / "assets/slides/venue-signs-manifest.json"
WIDTH, HEIGHT = A4
INSET = 14 * mm
RIGHT = WIDTH - INSET
CONTENT_WIDTH = RIGHT - INSET
INK = HexColor("#0b0b0b")
SIGNAL = HexColor("#d72f2f")
FONT_FILES = {
    "Headline": "assets/fonts/FinlandicaHeadline-Black.woff2",
    "Text": "assets/fonts/FinlandicaText-Regular.woff2",
    "Bold": "assets/fonts/FinlandicaText-Bold.woff2",
}


def register_fonts():
    for name, filename in FONT_FILES.items():
        font = FontToolsFont(ROOT / filename, recalcTimestamp=False)
        font.flavor = None
        data = io.BytesIO()
        font.save(data)
        data.seek(0)
        pdfmetrics.registerFont(TTFont(name, data))


def text(pdf, label, x, baseline, font, size, color=INK):
    width = pdfmetrics.stringWidth(label, font, size)
    ascent, descent = pdfmetrics.getAscentDescent(font, size)
    if (x < INSET - 0.1 or x + width > RIGHT + 0.1
            or baseline + descent < INSET or baseline + ascent > HEIGHT - INSET):
        raise ValueError(f"Text exceeds the print margins: {label}")
    pdf.setFillColor(color)
    pdf.setFont(font, size)
    pdf.drawString(x, baseline, label)


def headline(pdf, label, baseline, maximum=120):
    size = min(maximum, CONTENT_WIDTH / pdfmetrics.stringWidth(label, "Headline", 1))
    text(pdf, label, INSET, baseline, "Headline", size)


def rule(pdf, baseline):
    pdf.setStrokeColor(SIGNAL)
    pdf.setLineWidth(4)
    pdf.line(INSET, baseline, RIGHT, baseline)


def qr_code(pdf, url, x, y, side):
    # Four white modules surround every side of the code (the quiet zone).
    qr = QrCodeWidget(url, barBorder=4, barLevel="M")
    left, bottom, right, top = qr.getBounds()
    drawing = Drawing(side, side, transform=[
        side / (right - left), 0, 0, side / (top - bottom),
        -left * side / (right - left), -bottom * side / (top - bottom),
    ])
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, x, y)


def frame(pdf, event):
    pdf.setFillColor(HexColor("#ffffff"))
    pdf.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    text(pdf, f"{event['name']} / {event['year']}", INSET, 773, "Bold", 19)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(1)
    pdf.line(INSET, 748, RIGHT, 748)
    text(pdf, "sdlcai.org", INSET, 47, "Bold", 12)
    date_width = pdfmetrics.stringWidth(event["date"], "Text", 12)
    text(pdf, event["date"], RIGHT - date_width, 47, "Text", 12)


def event_title(pdf, event, baseline=618):
    headline(pdf, event["name"], baseline, 132)
    text(pdf, "AI meets SDLC", INSET, baseline - 46, "Text", 32)


def welcome(pdf, event):
    text(pdf, "WELCOME", INSET, 715, "Headline", 28, SIGNAL)
    event_title(pdf, event, baseline=600)
    rule(pdf, 533)
    text(pdf, event["weekday"], INSET, 486, "Bold", 22)
    headline(pdf, event["venue"], 403, 66)
    text(pdf, event["stage"], INSET, 362, "Text", 24)
    text(pdf, "Aalto University / Espoo", INSET, 327, "Text", 21)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(1)
    pdf.rect(INSET, 145, CONTENT_WIDTH, 125, stroke=1, fill=0)
    text(pdf, "REGISTRATION OPENS", INSET + 18, 232, "Bold", 19)
    text(pdf, event["doors"], INSET + 18, 167, "Headline", 70)


def direction(pdf, sign, event):
    event_title(pdf, event)
    rule(pdf, 533)
    # One filled polygon gives all variants a clear silhouette in monochrome.
    pdf.saveState()
    pdf.translate(WIDTH / 2, 343)
    pdf.rotate({"right": 0, "left": 180, "ahead": 90}[sign["direction"]])
    if sign["direction"] == "ahead":
        pdf.scale(0.9, 0.9)
    points = [(-180, -34), (37, -34), (37, -95), (180, 0),
              (37, 95), (37, 34), (-180, 34)]
    arrow = pdf.beginPath()
    arrow.moveTo(*points[0])
    for point in points[1:]:
        arrow.lineTo(*point)
    arrow.close()
    pdf.setFillColor(INK)
    pdf.drawPath(arrow, fill=1, stroke=0)
    pdf.restoreState()
    headline(pdf, "STRAIGHT AHEAD" if sign["direction"] == "ahead" else "THIS WAY", 126, 55)


def registration(pdf, event):
    headline(pdf, "REGISTRATION", 618, 90)
    headline(pdf, "CHECK-IN", 510, 112)
    rule(pdf, 471)
    text(pdf, "Please have your", INSET, 399, "Text", 34)
    text(pdf, "ticket ready.", INSET, 353, "Text", 34)
    text(pdf, "Collect your badge here.", INSET, 282, "Bold", 27)
    text(pdf, "OPENS AT", INSET, 187, "Bold", 17)
    headline(pdf, event["doors"], 110, 88)


def qa(pdf):
    headline(pdf, "ASK.", 623, 140)
    headline(pdf, "VOTE.", 500, 140)
    rule(pdf, 465)
    text(pdf, "Questions for the speakers", INSET, 420, "Bold", 25)
    text(pdf, "Scan to ask a question or vote.", INSET, 386, "Text", 21)
    qr_code(pdf, "https://sdlcai.org/qa/", (WIDTH - 200) / 2, 153, 200)
    label = "sdlcai.org/qa/"
    label_width = pdfmetrics.stringWidth(label, "Bold", 27)
    text(pdf, label, (WIDTH - label_width) / 2, 111, "Bold", 27)


def schedule(pdf, event, sessions):
    headline(pdf, "TODAY", 651, 90)
    text(pdf, event["weekday"], INSET, 606, "Bold", 22)
    text(pdf, f"{event['venue'].title()} / {event['stage']}", INSET, 574, "Text", 18)
    rule(pdf, 552)
    if len(sessions) > 11:
        raise ValueError("The schedule needs a layout review before adding more than 11 rows.")
    for index, session in enumerate(sessions):
        baseline = 516 - index * 34
        text(pdf, session["time"], INSET, baseline, "Bold", 14)
        text(pdf, session["title"], 180, baseline, "Bold", 22)
        pdf.setStrokeColor(HexColor("#d6d6d6"))
        pdf.setLineWidth(0.5)
        pdf.line(INSET, baseline - 12, RIGHT, baseline - 12)
    qr_code(pdf, "https://sdlcai.org/schedule/", INSET, 71, 74)
    text(pdf, "Full program & updates", 134, 117, "Bold", 20)
    text(pdf, "sdlcai.org/schedule/", 134, 87, "Text", 20)


def draw_sign(pdf, sign, event, sessions):
    frame(pdf, event)
    if sign["kind"] == "welcome":
        welcome(pdf, event)
    elif sign["kind"] == "direction":
        direction(pdf, sign, event)
    elif sign["kind"] == "registration":
        registration(pdf, event)
    elif sign["kind"] == "qa":
        qa(pdf)
    elif sign["kind"] == "schedule":
        schedule(pdf, event, sessions)
    else:
        raise ValueError(f"Unknown sign kind: {sign['kind']}")


def verify_pdf(filename, signs, event, sessions):
    document = PdfReader(filename)
    if len(document.pages) != len(signs):
        raise ValueError(f"Incorrect page count: {filename}")
    for page, sign in zip(document.pages, signs):
        if (abs(float(page.mediabox.width) - WIDTH) > 0.01
                or abs(float(page.mediabox.height) - HEIGHT) > 0.01):
            raise ValueError(f"Not A4 portrait: {sign['id']}")
        extracted = page.extract_text()
        expected = [event["name"], event["date"], "sdlcai.org"]
        expected += {
            "welcome": ["WELCOME", event["doors"], event["stage"]],
            "direction": ["STRAIGHT AHEAD" if sign.get("direction") == "ahead" else "THIS WAY"],
            "registration": ["REGISTRATION", "CHECK-IN", event["doors"]],
            "qa": ["ASK.", "VOTE.", "sdlcai.org/qa/"],
            "schedule": ["TODAY", "sdlcai.org/schedule/", *[
                value for session in sessions for value in [session["time"], session["title"]]
            ]],
        }[sign["kind"]]
        for label in expected:
            if label not in extracted:
                raise ValueError(f"Missing text on {sign['id']}: {label}")
        for ref in page["/Resources"]["/Font"].values():
            font = ref.get_object()
            if "/FontDescriptor" in font:
                descriptor = font["/FontDescriptor"].get_object()
                if not any(key in descriptor for key in ["/FontFile", "/FontFile2", "/FontFile3"]):
                    raise ValueError(f"Unembedded font: {sign['id']}")


def create_pdf(filename, signs, event, sessions):
    pdf = canvas.Canvas(str(filename), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle(f"{event['name']} {event['year']} / Venue signs / "
                 + (signs[0]["title"] if len(signs) == 1 else "A4 print pack"))
    pdf.setAuthor("SDLCAI")
    pdf.setSubject("A4 portrait. Print single-sided at 100% / actual size.")
    for sign in signs:
        pdf.bookmarkPage(sign["id"])
        pdf.addOutlineEntry(sign["title"], sign["id"])
        draw_sign(pdf, sign, event, sessions)
        pdf.showPage()
    pdf.save()
    verify_pdf(filename, signs, event, sessions)


def digest(filename):
    return hashlib.sha256(filename.read_bytes()).hexdigest()


def main():
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise SystemExit("Install Poppler (pdftoppm) to render the PDF previews.")
    register_fonts()
    seminar = json.loads((ROOT / "site/data/seminar.json").read_text())
    sessions = json.loads((ROOT / "site/data/schedule.json").read_text())["items"]
    signs = json.loads(SOURCE.read_text())["signs"]
    if len({sign["id"] for sign in signs}) != len(signs):
        raise ValueError("Venue-sign IDs must be unique.")
    event_date = date.fromisoformat(seminar["date"]["iso"])
    event = {
        "name": seminar["name"],
        "year": event_date.year,
        "date": seminar["date"]["display"],
        "weekday": f"{event_date.strftime('%A').upper()} {seminar['date']['display'].upper()}",
        "venue": seminar["venue"]["shortName"].upper(),
        "stage": seminar["venue"]["name"].removeprefix(seminar["venue"]["shortName"] + " "),
        "doors": next(item for item in sessions if item["id"] == "doors-open")["time"].split("-")[0],
    }
    for directory in [ASSET_DIR, OUTPUT_DIR, PACK.parent]:
        directory.mkdir(parents=True, exist_ok=True)
    create_pdf(PACK, signs, event, sessions)
    shutil.copyfile(PACK, PACK_ASSET)
    files = {str(PACK_ASSET.relative_to(ROOT)): digest(PACK_ASSET)}
    items = []
    for number, sign in enumerate(signs, start=1):
        stem = f"sdlcai-{event['year']}-{sign['id']}-a4"
        output = OUTPUT_DIR / f"{stem}.pdf"
        asset = ASSET_DIR / output.name
        preview = ASSET_DIR / f"{stem}.png"
        create_pdf(output, [sign], event, sessions)
        shutil.copyfile(output, asset)
        subprocess.run([renderer, "-f", "1", "-singlefile", "-scale-to", "900",
                        "-png", str(asset), str(preview.with_suffix(""))], check=True)
        for filename in [asset, preview]:
            files[str(filename.relative_to(ROOT))] = digest(filename)
        items.append({
            **sign, "number": f"{number:02d}", "page": number,
            "pdf": "/" + str(asset.relative_to(ROOT)),
            "preview": "/" + str(preview.relative_to(ROOT)),
        })
    sources = ["site/data/venue-signs.json", "site/data/seminar.json",
               "site/data/schedule.json", "scripts/export-venue-signs.py", *FONT_FILES.values()]
    MANIFEST.write_text(json.dumps({
        "pageCount": len(signs), "pdf": "/" + str(PACK_ASSET.relative_to(ROOT)),
        "items": items, "files": files,
        "sources": {filename: digest(ROOT / filename) for filename in sources},
    }, indent=2) + "\n")
    print(f"Exported and verified {len(signs)} A4 signs: {PACK.relative_to(ROOT)}")
    print(f"Updated individual PDFs, previews, and manifest in {ASSET_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
