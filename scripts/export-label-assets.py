"""Build SDLCAI label concepts with vector lettering and the supplier's water panel.

Dependencies: reportlab, pymupdf, fonttools[woff], pillow, qrcode.
The original AI is read as a PDF; it is never modified.
"""

from pathlib import Path
import argparse
import hashlib
import html
import io
import json
import math
import re

import pymupdf as fitz
import qrcode
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
TMP = ROOT / "tmp/pdfs"
PAPER, BLACK, DARK = "#f6f4ef", "#0b0b0b", "#101010"
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
    def __init__(self, name, title):
        self.name = name
        self.pdf = io.BytesIO()
        self.c = canvas.Canvas(self.pdf, pagesize=(W * MM, H * MM), pageCompression=1, pdfVersion=(1, 6))
        self.c.setTitle(title)
        self.c.setAuthor("SDLCAI")
        self.c.translate(0, H * MM)
        self.c.scale(MM, -MM)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="211mm" height="91mm" viewBox="0 0 211 91"><title>{html.escape(title)}</title><desc>205 x 85 mm trim. 3 mm bleed. Lettering is outlined. Named groups remain editable. Product details belong to the supplier.</desc>']
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

    def finish(self, supplier=None):
        self.c.showPage()
        self.c.save()
        doc = fitz.open(stream=self.pdf.getvalue(), filetype="pdf")
        page = doc[0]
        if supplier:
            panel = fitz.Rect(148 * MM, 0, supplier[0].rect.width, supplier[0].rect.height)
            oc = doc.add_ocg("Water supplier panel - original template")
            page.show_pdf_page(panel, supplier, 0, clip=panel, oc=oc)
            raw = supplier[0].get_svg_image(text_as_path=True)
            raw = re.sub(r'^<svg\b[^>]*>', '', raw).rsplit('</svg>', 1)[0]
            # Root-space clipping also works in editors with limited nested-SVG support.
            self.svg.append(f'<defs><clipPath id="water-panel-clip"><rect x="148" y="0" width="63" height="91"/></clipPath></defs><g id="original-water-supplier-panel" clip-path="url(#water-panel-clip)"><g transform="scale({1/MM})">{raw}</g></g>')
        page.set_trimbox(fitz.Rect(3*MM, 3*MM, 208*MM, 88*MM))
        page.set_bleedbox(page.mediabox)
        doc.set_metadata({"title": self.name.replace("-", " "), "author": "SDLCAI", "subject": "205 x 85 mm trim; 3 mm bleed; RGB vector artwork; supplier confirmation required"})
        doc.save(OUT / f"{self.name}.pdf", garbage=4, deflate=True)
        self.svg.append('<defs><g id="non-printing-trim-guide"><rect x="3" y="3" width="205" height="85" fill="none" stroke="#ff00ff" stroke-width="0.1"/></g></defs></svg>')
        (SRC / f"{self.name}.svg").write_text('\n'.join(self.svg))
        (SRC / f"{self.name}-copy.txt").write_text('\n'.join(self.copy) + '\n')
        bad = [(t, b) for t, b in self.bounds if b[0] < 6 or b[1] < 6 or b[2] > 205 or b[3] > 85]
        if bad:
            raise ValueError(f"Text outside 3 mm safety inset: {bad}")
        return doc


def label(kind, supplier):
    water = kind == "sparkling-water-light"
    name = f"sdlcai-{kind}" + ("" if water else "-preliminary")
    a = Artwork(name, "SDLCAI / Sparkling water / Light theme" if water else "SDLCAI / Lager / Dark theme / Preliminary")
    bg, ink, muted, dot = (PAPER, BLACK, "#69645d", "#d2cec5") if water else (DARK, PAPER, "#b7b0a4", "#393733")
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
    if water:
        a.qr(9.5, 67.5, 17)
        a.text("EXPLORE THE PROGRAM", 29, 73, 5.2, muted, "bold")
        a.text("SDLCAI.ORG", 29, 78.2, 10.1, ink, "headline")
    else:
        a.text("THANKS FOR", 10, 73, 14, ink, "headline")
        a.text("JOINING US.", 10, 78.5, 14, ink, "headline")
        a.text("SDLCAI.ORG", 10, 84, 7.2, muted, "bold", tracking=.3)
    a.line(55, 10, 55, 82, ink, .2)
    a.end()
    a.group("front-brand-and-product")
    a.text("AI MEETS SDLC", 102, 11.8, 8, ink, "bold", "center", tracking=.65)
    a.text("SDLCAI", 102, 34.5, 69, ink, "headline", "center", fit=80)
    a.line(62, 41, 142, 41, ink, .65)
    if water:
        a.text("SPARKLING", 102, 55.7, 31.5, ink, "headline", "center")
        a.text("WATER", 102, 71, 48, ink, "headline", "center")
        a.text("KIVENNÄISVESI", 63, 81, 8.6, ink, "bold", tracking=.18)
    else:
        a.text("LAGER", 102, 67, 65, ink, "headline", "center")
        a.text("OLUT / ÖL", 63, 81, 8.6, ink, "bold", tracking=.18)
    a.text("330 ml", 141, 81, 10, ink, "bold", "right")
    a.end()
    if not water:
        a.group("preliminary-brewery-panel")
        a.rect(150, 0, 61, 91, "#1d1c1a")
        a.line(157, 12, 201, 12, muted, .2)
        a.text("BREWERY PANEL", 157, 18.5, 11.5, ink, "headline")
        a.text("PRELIMINARY LAYOUT", 157, 23.7, 6.5, muted, "bold", tracking=.14)
        for y, value in [(34, "Reserved for the brewery's"), (38.5, "product information and artwork."), (49, "ABV / ingredients / allergens"), (53.5, "Producer / batch / best before"), (58, "Barcode / deposit markings")]:
            a.text(value, 157, y, 7.3, muted)
        a.line(157, 67, 201, 67, muted, .2)
        a.text("330 ml assumed for this concept.", 157, 74, 7.1, ink)
        a.text("Final size follows the lager template.", 157, 79, 7.1, muted)
        a.end()
    return a.finish(supplier if water else None)


def review(docs):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(297*MM, 315*MM), pdfVersion=(1, 6))
    c.setFillColorRGB(*rgb("#e4e0d7"))
    c.rect(0, 0, 297*MM, 315*MM, fill=1, stroke=0)
    c.setFillColorRGB(*rgb(BLACK))
    c.setFont("Helvetica-Bold", 20)
    c.drawString(17*MM, 297*MM, "SDLCAI / LABEL DESIGNS")
    c.setFont("Helvetica", 9)
    c.drawString(17*MM, 288*MM, "205 x 85 mm trim  /  3 mm bleed  /  Finlandica type  /  SDLCAI light and dark themes")
    for y, title, subtitle in [(273, "01  SPARKLING WATER / LIGHT", "Original water supplier panel retained. Supplier to confirm the existing date and product details."), (139, "02  LAGER / DARK", "Preliminary design. Brewery information and final lager template pending. 330 ml assumed.")]:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(17*MM, y*MM, title)
        c.setFont("Helvetica", 8)
        c.drawString(17*MM, (y-7)*MM, subtitle)
    c.setFont("Helvetica", 7)
    c.drawString(17*MM, 8*MM, "DESIGN REVIEW  /  RGB color proof. Final print profile and production details to be confirmed with the supplier.")
    c.showPage()
    c.save()
    result = fitz.open(stream=buf.getvalue(), filetype="pdf")
    p = result[0]
    for doc, top in zip(docs, (56, 190)):
        rect = fitz.Rect(17*MM, top*MM, 280*MM, (top + 263*85/205)*MM)
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
    parser.add_argument("--template", type=Path, default=Path("/Users/juhovepsalainen/Downloads/-kivennaisvesi (2).ai"))
    args = parser.parse_args()
    for folder in (OUT, SRC, PRE, TMP):
        folder.mkdir(parents=True, exist_ok=True)
    before = hashlib.sha256(args.template.read_bytes()).hexdigest()
    original = visible_template(args.template)
    docs = [label("sparkling-water-light", original), label("lager-dark", original)]
    board = review(docs)
    for name, doc in zip(["sdlcai-sparkling-water-light", "sdlcai-lager-dark-preliminary"], docs):
        doc[0].get_pixmap(matrix=fitz.Matrix(300/72, 300/72), clip=doc[0].trimbox, alpha=False).save(PRE / f"{name}.png")
    board[0].get_pixmap(matrix=fitz.Matrix(1.8, 1.8), alpha=False).save(PRE / "sdlcai-label-design-review.png")
    report = {"template_sha256": before, "template_unchanged": before == hashlib.sha256(args.template.read_bytes()).hexdigest(), "trim_mm": [205, 85], "bleed_mm": 3, "artboard_mm": [211, 91], "color_space": "RGB; supplier print conversion pending", "qr_url": "https://sdlcai.org/", "water_supplier_panel": "Original vector artwork, original position and scale", "lager": "Preliminary; 330 ml assumed; brewery details pending", "outputs": []}
    for doc in docs:
        p = doc[0]
        assert len(doc) == 1
        assert not p.get_images(), "Labels should contain no raster images"
        assert abs(p.trimbox.width/MM - 205) < .001
        assert abs(p.trimbox.height/MM - 85) < .001
        report["outputs"].append({"trimbox_pt": list(p.trimbox), "raster_images": len(p.get_images())})
    (SRC.parent / "verification.json").write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
