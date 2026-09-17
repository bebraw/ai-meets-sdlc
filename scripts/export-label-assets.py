"""Build SDLCAI labels with outlined lettering and original supplier artwork.

Dependencies: reportlab, pymupdf, pypdf, fonttools[woff], pillow, qrcode, zxing-cpp.
Original supplier files are never modified.
"""

from pathlib import Path
import argparse
import hashlib
import html
import io
import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET

import pymupdf as fitz
import qrcode
import zxingcpp
from PIL import Image
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from pypdf import PdfWriter
from pypdf.generic import ContentStream
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
MM = 72 / 25.4
W, H = 211, 91
OUT = ROOT / "output/pdf"
SRC = ROOT / "assets/labels/source"
PRE = ROOT / "assets/labels/previews"
PAPER, BLACK = "#f6f4ef", "#0b0b0b"
FONTS = {}
for key, name in [("headline", "FinlandicaHeadline-Black"), ("regular", "FinlandicaText-Regular"), ("bold", "FinlandicaText-Bold")]:
    FONTS[key] = TTFont(ROOT / f"assets/fonts/{name}.woff2")
FONTS["logo"] = TTFont("/System/Library/Fonts/Supplemental/Arial Black.ttf")


class CanvasPen(BasePen):
    def __init__(self, gs, path):
        super().__init__(gs)
        self.path = path

    def _moveTo(self, p):
        self.path.moveTo(*p)

    def _lineTo(self, p):
        self.path.lineTo(*p)

    def _curveToOne(self, a, b, c):
        self.path.curveTo(*a, *b, *c)

    def _closePath(self):
        self.path.close()


def rgb(value):
    return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))


class Artwork:
    def __init__(self, name, title, width=W, height=H, bleed=3):
        self.name = name
        self.width, self.height, self.bleed = width, height, bleed
        self.pdf = io.BytesIO()
        self.c = canvas.Canvas(self.pdf, pagesize=(width * MM, height * MM), pageCompression=1, pdfVersion=(1, 6))
        self.c.setTitle(title)
        self.c.setAuthor("SDLCAI")
        self.c.translate(0, height * MM)
        self.c.scale(MM, -MM)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}"><title>{html.escape(title)}</title><desc>{width-2*bleed:g} x {height-2*bleed:g} mm trim. {bleed} mm bleed. SDLCAI lettering is outlined. Named groups remain editable. Product details belong to the supplier.</desc>']
        self.copy = []
        self.bounds = []

    def group(self, name):
        self.svg.append(f'<g id="{name}">')

    def end(self):
        self.svg.append('</g>')

    def color(self, fill):
        self.c.setFillColorRGB(*rgb(fill))

    def rect(self, x, y, w, h, fill):
        self.color(fill)
        self.c.rect(x, y, w, h, fill=1, stroke=0)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>')

    def circle(self, x, y, r, fill):
        self.color(fill)
        self.c.circle(x, y, r, fill=1, stroke=0)
        self.svg.append(f'<circle cx="{x:.4f}" cy="{y:.4f}" r="{r:.4f}" fill="{fill}"/>')

    def line(self, x1, y1, x2, y2, color, width=.2):
        self.c.setStrokeColorRGB(*rgb(color))
        self.c.setLineWidth(width)
        self.c.line(x1, y1, x2, y2)
        self.svg.append(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')

    def text(self, value, x, y, size, fill, font="regular", align="left", tracking=0, fit=None, safe=True):
        f = FONTS[font]
        gs, cmap = f.getGlyphSet(), f.getBestCmap()
        scale = size / MM / f["head"].unitsPerEm
        advances = [f["hmtx"].metrics[cmap[ord(ch)]][0] for ch in value]
        width = sum(advances) * scale + max(0, len(value) - 1) * tracking
        sx = min(1, fit / width) if fit else 1
        width *= sx
        origin = x - (width / 2 if align == "center" else width if align == "right" else 0)
        self.svg.append(f'<g aria-label="{html.escape(value, quote=True)}" fill="{fill}">')
        self.c.saveState()
        self.c.translate(origin, y)
        self.c.scale(sx * scale, -scale)
        self.color(fill)
        position = 0
        for ch, advance in zip(value, advances):
            glyph = gs[cmap[ord(ch)]]
            pen = SVGPathPen(gs)
            glyph.draw(pen)
            d = pen.getCommands()
            if d:
                gx = origin + position * scale * sx
                self.svg.append(f'<path transform="translate({gx:.6f} {y}) scale({scale*sx:.9f} {-scale:.9f})" d="{d}"/>')
                self.c.saveState()
                self.c.translate(position, 0)
                p = self.c.beginPath()
                glyph.draw(CanvasPen(gs, p))
                self.c.drawPath(p, fill=1, stroke=0)
                self.c.restoreState()
                bp = BoundsPen(gs)
                glyph.draw(bp)
                a, b, c, d = bp.bounds
                box = (gx + a * scale * sx, y - d * scale, gx + c * scale * sx, y - b * scale)
                if safe:
                    self.bounds.append((value, box))
            position += advance + tracking / scale
        self.c.restoreState()
        self.svg.append('</g>')
        self.copy.append(value)

    def logo(self, x, y, size):
        # Match the geometry, colors, and type of assets/logo.svg.
        self.group("official-sdlcai-mark")
        s = size / 160
        self.rect(x, y, size, size, PAPER)
        self.rect(x + 8*s, y + 8*s, 144*s, 68*s, BLACK)
        self.rect(x + 8*s, y + 88*s, 144*s, 64*s, BLACK)
        self.text("SDLC", x + 80*s, y + 57*s, 44*s*MM, PAPER, "logo", "center", fit=126*s)
        self.text("AI", x + 83*s, y + 139*s, 58*s*MM, PAPER, "logo", "center")
        self.end()

    def qr(self, x, y, size):
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=1, border=4)
        qr.add_data("https://sdlcai.org/")
        qr.make(fit=True)
        matrix = qr.get_matrix()
        module = size / len(matrix)
        self.rect(x, y, size, size, "#ffffff")
        for iy, row in enumerate(matrix):
            for ix, cell in enumerate(row):
                if cell:
                    self.rect(x + ix*module, y + iy*module, module, module, BLACK)

    def finish(self, supplier=None, template_base=None):
        self.c.showPage()
        self.c.save()
        doc = fitz.open(stream=self.pdf.getvalue(), filetype="pdf")
        if template_base is not None:
            # Clone the complete template; add only our transparent vector overlay.
            # This preserves the original CMYK content, barcode image, page boxes,
            # brewery artwork, and source coordinates without clipping or scaling.
            overlay = doc
            doc = fitz.open(stream=template_base.tobytes(), filetype="pdf")
            # Discard stale Illustrator private data so editors read the updated
            # PDF artwork instead of reopening the original embedded AI document.
            for xref in (doc.pdf_catalog(), doc[0].xref):
                doc.xref_set_key(xref, "PieceInfo", "null")
            doc.xref_set_key(doc[0].xref, "Thumb", "null")
            doc.del_xml_metadata()
            oc = doc.add_ocg("SDLCAI afterparty artwork")
            doc[0].show_pdf_page(doc[0].rect, overlay, 0, oc=oc)
            raw = template_base[0].get_svg_image(text_as_path=True)
            raw = re.sub(r'^<svg\b[^>]*>', '', raw).rsplit('</svg>', 1)[0]
            self.svg.insert(1, f'<g id="original-masis-brewery-template" transform="scale({1/MM})">{raw}</g>')
        page = doc[0]
        if supplier:
            panel = fitz.Rect(148 * MM, 0, supplier[0].rect.width, supplier[0].rect.height)
            oc = doc.add_ocg("Water supplier panel - original template")
            page.show_pdf_page(panel, supplier, 0, clip=panel, oc=oc)
            raw = supplier[0].get_svg_image(text_as_path=True)
            raw = re.sub(r'^<svg\b[^>]*>', '', raw).rsplit('</svg>', 1)[0]
            # Root-space clipping also works in editors with limited nested-SVG support.
            self.svg.append(f'<defs><clipPath id="water-panel-clip"><rect x="148" y="0" width="63" height="91"/></clipPath></defs><g id="original-water-supplier-panel" clip-path="url(#water-panel-clip)"><g transform="scale({1/MM})">{raw}</g></g>')
        b, w, h = self.bleed, self.width, self.height
        if template_base is None:
            page.set_trimbox(fitz.Rect(b*MM, b*MM, (w-b)*MM, (h-b)*MM))
            page.set_bleedbox(page.mediabox)
        doc.set_metadata({"title": self.name.replace("-", " "), "author": "SDLCAI", "subject": f"{w-2*b:g} x {h-2*b:g} mm trim; {b} mm bleed; design proof; original supplier artwork retained"})
        doc.save(OUT / f"{self.name}.pdf", garbage=4, deflate=True)
        self.svg.append(f'<defs><g id="non-printing-trim-guide"><rect x="{b}" y="{b}" width="{w-2*b}" height="{h-2*b}" fill="none" stroke="#ff00ff" stroke-width="0.1"/></g></defs></svg>')
        svg_text = '\n'.join(self.svg)
        ET.fromstring(svg_text)
        (SRC / f"{self.name}.svg").write_text(svg_text)
        (SRC / f"{self.name}-copy.txt").write_text('\n'.join(self.copy) + '\n')
        bad = [(t, box) for t, box in self.bounds if box[0] < b+3 or box[1] < b+3 or box[2] > w-b-3 or box[3] > h-b-3]
        if bad:
            raise ValueError(f"Text outside 3 mm safety inset: {bad}")
        return doc


def water_label(supplier):
    a = Artwork("sdlcai-sparkling-water-light", "SDLCAI / Sparkling water / Light theme")
    bg, ink, muted, dot = PAPER, BLACK, "#69645d", "#d2cec5"
    a.group("background-and-halftone")
    a.rect(0, 0, W, H, bg)
    # A clipped halftone disc echoes the site's circular texture.
    for ix in range(61):
        for iy in range(62):
            x, y = 78 + ix*1.2, 30 + iy*1.2
            d = math.hypot(x - 129, y - 69)
            if d < 30 and x < 148 and y < 91:
                a.circle(x, y, .11 + .05 * (1 - d/30), dot)
    a.end()
    a.group("event-and-program")
    a.logo(10, 10, 15)
    a.text("AI MEETS", 29, 15.5, 9, ink, "headline")
    a.text("SDLC", 29, 21, 14, ink, "headline")
    a.line(10, 30, 49, 30, ink, .25)
    for y, value in [(37, "AI across the full software"), (41.2, "development lifecycle."), (47.4, "Industry. Research."), (51.6, "A shared conversation.")]:
        a.text(value, 10, y, 8, muted if y < 45 else ink, "regular" if y < 45 else "bold")
    a.text("13 OCT 2026", 10, 60.2, 14, ink, "headline")
    a.text("MARSIO / AALTO UNIVERSITY", 10, 64.4, 6.9, muted, "bold")
    a.qr(9.5, 67.5, 17)
    a.text("EXPLORE THE PROGRAM", 29, 73, 5.2, muted, "bold")
    a.text("SDLCAI.ORG", 29, 78.2, 10.1, ink, "headline")
    a.line(55, 10, 55, 82, ink, .2)
    a.end()
    a.group("front-brand-and-product")
    a.text("AI MEETS SDLC", 102, 11.8, 8, ink, "bold", "center", tracking=.65)
    a.text("SDLCAI", 102, 34.5, 69, ink, "headline", "center", fit=80)
    a.line(62, 41, 142, 41, ink, .65)
    a.text("SPARKLING", 102, 55.7, 31.5, ink, "headline", "center")
    a.text("WATER", 102, 71, 48, ink, "headline", "center")
    a.text("KIVENNÄISVESI", 63, 81, 8.6, ink, "bold", tracking=.18)
    a.text("330 ml", 141, 81, 10, ink, "bold", "right")
    a.end()
    return a.finish(supplier)


def lager_label(supplier):
    a = Artwork("sdlcai-lager-dark", "SDLCAI / Afterparty lager / Masis Brewery", 204, 119, 2)
    ink, muted, dot = PAPER, "#b7b0a4", "#393733"
    # The supplier's full-bleed background remains underneath this overlay.
    a.group("halftone")
    for ix in range(65):
        for iy in range(67):
            x, y = 89 + ix*1.2, 39 + iy*1.2
            d = math.hypot(x - 145, y - 86)
            if d < 36 and x < 170 and y < 119:
                a.circle(x, y, .11 + .05 * (1 - d/36), dot)
    a.end()
    a.group("event-and-thanks")
    a.logo(10, 11, 16)
    a.text("AI MEETS", 30, 17, 9, ink, "headline")
    a.text("SDLC", 30, 23, 14, ink, "headline")
    a.line(10, 35, 49, 35, ink, .25)
    for y, value in [(45, "AI across the full software"), (49.2, "development lifecycle."), (57, "Industry. Research."), (61.2, "A shared conversation.")]:
        a.text(value, 10, y, 8, muted if y < 50 else ink, "regular" if y < 50 else "bold")
    a.text("13 OCT 2026", 10, 78, 14, ink, "headline")
    a.text("MARSIO / AALTO UNIVERSITY", 10, 83, 6.9, muted, "bold")
    a.text("THANKS FOR", 10, 98, 14, ink, "headline")
    a.text("JOINING US.", 10, 104, 14, ink, "headline")
    a.text("SDLCAI.ORG", 10, 110, 7.2, muted, "bold", tracking=.3)
    a.line(55, 11, 55, 110, ink, .2)
    a.end()
    a.group("front-brand-and-product")
    a.text("AI MEETS SDLC", 115, 17, 9, ink, "bold", "center", tracking=.8)
    a.text("SDLCAI", 115, 49, 90, ink, "headline", "center", fit=104)
    a.line(63, 59, 167, 59, ink, .65)
    a.text("LAGER", 115, 88, 83, ink, "headline", "center", fit=102)
    a.text("OLUT / ÖL", 63, 108, 9, ink, "bold", tracking=.18)
    a.text("5.0% vol", 117, 108, 9, ink, "bold", "center")
    a.text("440 ml", 167, 108, 11, ink, "bold", "right")
    a.end()
    # All original brewery foreground artwork starts beyond x=175.98 mm.
    assert all(box[2] < 170 for _, box in a.bounds)
    return a.finish(template_base=supplier)


def review(docs):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(297*MM, 360*MM), pdfVersion=(1, 6))
    c.setFillColorRGB(*rgb("#e4e0d7"))
    c.rect(0, 0, 297*MM, 360*MM, fill=1, stroke=0)
    c.setFillColorRGB(*rgb(BLACK))
    c.setFont("Helvetica-Bold", 20)
    c.drawString(17*MM, 342*MM, "SDLCAI / LABEL DESIGNS")
    c.setFont("Helvetica", 9)
    c.drawString(17*MM, 333*MM, "Finlandica type  /  SDLCAI light and dark themes  /  Original supplier artwork retained")
    for y, title, subtitle in [(318, "01  SPARKLING WATER / LIGHT", "205 x 85 mm trim / 3 mm bleed. Existing water design retained."), (184, "02  AFTERPARTY LAGER / DARK", "Masis template: 200 x 115 mm trim / 2 mm bleed. 440 ml / 5.0% vol. Original brewery panel retained.")]:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(17*MM, y*MM, title)
        c.setFont("Helvetica", 8)
        c.drawString(17*MM, (y-7)*MM, subtitle)
    c.setFont("Helvetica", 7)
    c.drawString(17*MM, 8*MM, "DESIGN REVIEW / Enlarged labels. Use individual PDFs for dimensions. Final print profile and batch date to be confirmed.")
    c.showPage()
    c.save()
    result = fitz.open(stream=buf.getvalue(), filetype="pdf")
    p = result[0]
    for doc, top in zip(docs, (56, 190)):
        ratio = doc[0].trimbox.height / doc[0].trimbox.width
        rect = fitz.Rect(17*MM, top*MM, 280*MM, (top + 263*ratio)*MM)
        p.show_pdf_page(rect, doc, 0, clip=doc[0].trimbox)
    result.set_metadata({"title": "SDLCAI - paired label design review", "author": "SDLCAI"})
    result.save(OUT / "sdlcai-label-design-review.pdf", garbage=4, deflate=True)
    return result


def visible_template(path):
    """Bake the source's layer visibility into vector content before importing.

    Imported PDF Form XObjects do not carry the source catalog's OFF list.
    The supplier watermark is hidden in the original, so omit its marked
    content from this in-memory copy while retaining every visible vector.
    """
    writer = PdfWriter(clone_from=path)
    page = writer.pages[0]
    off = {ref.idnum for ref in writer.root_object["/OCProperties"]["/D"]["/OFF"]}
    properties = page["/Resources"]["/Properties"]
    content = ContentStream(page.get_contents(), writer)
    operations, stack = [], []
    for operands, operator in content.operations:
        if operator in (b"BDC", b"BMC"):
            optional = operator == b"BDC" and str(operands[0]) == "/OC"
            hidden = any(item[1] for item in stack)
            if optional:
                ref = properties.raw_get(operands[1])
                hidden = hidden or ref.idnum in off
            stack.append((optional, hidden))
            if not optional and not hidden:
                operations.append((operands, operator))
        elif operator == b"EMC":
            optional, hidden = stack.pop()
            if not optional and not hidden:
                operations.append((operands, operator))
        elif not any(item[1] for item in stack):
            operations.append((operands, operator))
    assert not stack
    content.operations = operations
    page.replace_contents(content)
    buf = io.BytesIO()
    writer.write(buf)
    return fitz.open(stream=buf.getvalue(), filetype="pdf")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, help="Optional water template; omit to retain the existing water label")
    parser.add_argument("--lager-template", type=Path, default=SRC.parent / "templates/masis-lager-2026-09.pdf")
    args = parser.parse_args()
    for folder in (OUT, SRC, PRE):
        folder.mkdir(parents=True, exist_ok=True)
    before = hashlib.sha256(args.lager_template.read_bytes()).hexdigest()
    original = fitz.open(args.lager_template)
    assert len(original) == 1
    assert abs(original[0].rect.width/MM - 204) < .001
    assert abs(original[0].rect.height/MM - 119) < .001
    assert abs(original[0].trimbox.width/MM - 200) < .001
    assert abs(original[0].trimbox.height/MM - 115) < .001
    water_path = OUT / "sdlcai-sparkling-water-light.pdf"
    water_before = hashlib.sha256(water_path.read_bytes()).hexdigest() if water_path.exists() else None
    if args.template:
        water = water_label(visible_template(args.template))
        water[0].get_pixmap(dpi=300, clip=water[0].trimbox, alpha=False).save(PRE / "sdlcai-sparkling-water-light.png")
    else:
        water = fitz.open(water_path)
    docs = [water, lager_label(original)]
    board = review(docs)
    docs[1][0].get_pixmap(dpi=300, clip=docs[1][0].trimbox, alpha=False).save(PRE / "sdlcai-lager-dark.png")
    board[0].get_pixmap(matrix=fitz.Matrix(1.8, 1.8), alpha=False).save(PRE / "sdlcai-label-design-review.png")
    # Compare the complete brewery panel at 600 dpi, including the barcode.
    panel = fitz.Rect(174*MM, 0, original[0].rect.width, original[0].rect.height)
    expected = original[0].get_pixmap(dpi=600, clip=panel, alpha=False)
    actual = docs[1][0].get_pixmap(dpi=600, clip=panel, alpha=False)
    assert expected.samples == actual.samples, "Original brewery panel changed"
    def barcodes(pixmap):
        bitmap = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        return [(str(code.format), code.text) for code in zxingcpp.read_barcodes(bitmap)]
    decoded = barcodes(actual)
    assert decoded == barcodes(expected) == [("EAN-13", "6430079213034")]
    assert docs[1][0].mediabox == original[0].mediabox
    assert docs[1][0].trimbox == original[0].trimbox
    assert docs[1][0].bleedbox == original[0].bleedbox
    images = docs[1][0].get_image_info(hashes=True)
    source_images = original[0].get_image_info(hashes=True)
    assert [(i['digest'], i['bbox']) for i in images] == [(i['digest'], i['bbox']) for i in source_images]
    assert before == hashlib.sha256(args.lager_template.read_bytes()).hexdigest()
    water_after = hashlib.sha256(water_path.read_bytes()).hexdigest()
    if not args.template:
        assert water_before == water_after
    report = {
        "water": {"trim_mm": [205, 85], "bleed_mm": 3, "pdf_sha256": water_after,
                  "retained_existing_pdf": not bool(args.template), "qr_url": "https://sdlcai.org/"},
        "lager": {
            "template": str(args.lager_template.relative_to(ROOT)) if args.lager_template.is_relative_to(ROOT) else str(args.lager_template),
            "template_sha256": before, "template_unchanged": True,
            "trim_mm": [200, 115], "bleed_mm": 2, "artboard_mm": [204, 119],
            "trimbox_pt": list(docs[1][0].trimbox), "page_boxes_match_template": True,
            "volume_ml": 440, "abv_percent": 5.0, "best_before_from_template": "08/2027",
            "brewery_panel": "Complete original template retained; new artwork ends before x=170 mm",
            "brewery_panel_pixel_identical_at_dpi": 600,
            "decoded_barcode": decoded,
            "source_raster_images": len(source_images), "output_raster_images": len(images),
            "source_image_pixels_and_position_unchanged": True,
            "new_lettering": "Outlined vector paths, named SVG groups and PDF artwork layer",
            "color_space": "Original CMYK template plus RGB SDLCAI artwork; supplier print conversion pending",
        },
    }
    (SRC.parent / "verification.json").write_text(json.dumps(report, indent=2) + '\n')
    # The bundle always contains the current designs, not the superseded concept.
    files = [SRC.parent / "README.md", SRC.parent / "verification.json", args.lager_template]
    for name in ("sdlcai-sparkling-water-light", "sdlcai-lager-dark"):
        files += [OUT / f"{name}.pdf", SRC / f"{name}.svg", SRC / f"{name}-copy.txt", PRE / f"{name}.png"]
    files += [OUT / "sdlcai-label-design-review.pdf", PRE / "sdlcai-label-design-review.png"]
    with zipfile.ZipFile(ROOT / "output/sdlcai-label-designs.zip", "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in files:
            archive_path = path.relative_to(ROOT) if path.is_relative_to(ROOT) else Path("assets/labels/templates") / path.name
            bundle.write(path, archive_path)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
