# SDLCAI beverage labels

The afterparty lager uses the official September 2026 Masis Brewery template.
It retains the SDLCAI dark design, Finlandica lettering, square mark, halftone
texture, and "Thanks for joining us" message. The water design is unchanged.

## Current files

- [Afterparty lager PDF](../../../output/pdf/sdlcai-lager-dark.pdf)
- [Editable lager SVG](source/sdlcai-lager-dark.svg)
- [Lager wording](source/sdlcai-lager-dark-copy.txt)
- [Water PDF](../../../output/pdf/sdlcai-sparkling-water-light.pdf)
- [Paired design review](../../../output/pdf/sdlcai-label-design-review.pdf)
- [Complete handoff bundle](../../../output/sdlcai-label-designs.zip)
- `previews/*.png`: 300 dpi trimmed label previews and the paired review image.
- `verification.json`: source hash, geometry, artwork preservation, and barcode checks.
- `templates/masis-lager-2026-09.pdf`: unchanged copy of the supplied official PDF.

The previous `sdlcai-lager-dark-preliminary` concept is superseded by
`sdlcai-lager-dark`; its old dimensions and assumed 330 ml volume do not apply.

## Dimensions and Illustrator handoff

| Label | Trim | Bleed per edge | Full canvas |
| --- | --- | --- | --- |
| Masis lager | 200 x 115 mm | 2 mm | 204 x 119 mm |
| Sparkling water | 205 x 85 mm | 3 mm | 211 x 91 mm |

The lager PDF retains the exact MediaBox, TrimBox, and BleedBox from the brewery
PDF. Open it in Illustrator using TrimBox for the finished label or MediaBox
for the full canvas. Its SDLCAI artwork is on a separate PDF layer over the
original template. Stale Illustrator private data is removed from the output
so the updated visible PDF artwork is imported.

The SVG has named groups, embedded supplier artwork, and a non-rendering trim
guide. All new lettering is outlined. Revise wording in the generator or reset
it with the project Finlandica fonts. The SVG's supplier colors are converted
to RGB for editing/preview; the PDF retains the original supplier CMYK colors.
Use the PDF as the authoritative template-preserving handoff.

The deliverables are PDF and SVG. A native `.ai` can be saved from Illustrator
after opening either format. Both supplied originals in Downloads are untouched.

## Brewery artwork and production status

The entire Masis template is retained as the PDF base at its original scale and
position: full-bleed background, Masis logo, multilingual ingredients and allergen
emphasis, producer, vegan/gluten-free wording, storage text, brewery/recycling
marks, barcode, and the existing `08/2027` best-before date. These details come
from the brewery file. The front now matches its **440 ml / 5.0% vol** product.

New artwork ends before x=170 mm; the original brewery foreground begins beyond
x=175.98 mm. The full right panel is pixel-identical to the source at 600 dpi.
The original raster barcode image is preserved without resampling; it decodes
as EAN-13 `6430079213034`. No new raster artwork is added.

These are design proofs, not PDF/X press files. The lager combines the supplier's
original CMYK artwork with the SDLCAI RGB colors. The brewery/printer should
confirm the final profile, ink treatment, and batch date before print export.
The water supplier's existing product information and `9/2027` date still need
production confirmation. The review sheet enlarges both labels independently;
use the individual PDFs for physical dimensions.

## Regenerate

Use Python with `reportlab`, `pymupdf`, `pypdf`, `fonttools[woff]`, `pillow`,
`qrcode`, and `zxing-cpp`, then run from the repository root:

```sh
python scripts/export-label-assets.py
```

This updates the lager, review sheet, previews, verification record, and bundle,
while retaining the existing water files. It reads the checked-in Masis PDF.
Use `--lager-template '/path/to/template.pdf'` to select the same template from
another location. To regenerate water as well, supply its original template:

```sh
python scripts/export-label-assets.py --template '/path/to/-kivennaisvesi (2).ai'
```

The generator uses `assets/fonts/*.woff2` and macOS Arial Black for the square
mark. It checks a 3 mm safety inset for new lettering, exact template page boxes,
unchanged brewery-panel pixels, barcode decoding, unchanged source image pixels
and position, and source-file hashes.
