# SDLCAI beverage labels

Two label designs using the site's Finlandica fonts, light/dark colors, square
mark, strong rules, and halftone texture. The water's QR code links to
`https://sdlcai.org/`. The lager closes the day with "Thanks for joining us"
and the website address, without a program call to action.

## Files

- `../../output/pdf/sdlcai-sparkling-water-light.pdf`: water label at template size.
- `../../output/pdf/sdlcai-lager-dark-preliminary.pdf`: preliminary lager concept.
- `../../output/pdf/sdlcai-label-design-review.pdf`: both designs on one review sheet.
- `source/*.svg`: self-contained vector masters with named groups and outlined lettering.
- `source/*-copy.txt`: the new label wording in plain text for future revisions.
- `previews/*.png`: 300 dpi trimmed label previews and a paired review image.

## Illustrator handoff

Open either individual PDF in Illustrator using its TrimBox for a 205 x 85 mm
artboard, or its MediaBox for the full 211 x 91 mm canvas. The PDF has 3 mm bleed
on each edge. The SVG masters use the full 211 x 91 mm canvas and include a
non-rendering trim-guide definition at x=3, y=3, width=205, height=85 mm.

The output is PDF and SVG, not native `.ai`. Save an opened file as `.ai` in
Illustrator if that format is needed. All new lettering is outlined to avoid
font substitution: shapes can be edited directly; wording changes should be
made in the generator or reset with the project Finlandica fonts. There are no
linked images, external font dependencies, or raster artwork in either label.

## Product and print status

The water label preserves the supplied AI file's visible supplier artwork at
its original position and scale: ingredients, nutrition, producer, barcode,
deposit/origin marks, and the existing `9/2027` date. The source's hidden
watermark stays hidden. The original AI file is unchanged. Its generic marketing
placeholders were replaced with SDLCAI content. The supplier still needs to
confirm the existing product details and date for the actual production batch.

The lager uses the water template's dimensions provisionally and assumes a
330 ml can. Its right-hand panel is explicitly reserved for brewery artwork.
No ABV, ingredients, allergen statement, producer, barcode, deposit, or expiry
information has been invented. Refit it when the lager template arrives.

The new artwork uses the site's RGB values: light `#f6f4ef` / `#0b0b0b`, dark
`#101010` / `#f6f4ef`. These are design proofs, not PDF/X press files. Obtain the
printer's required ICC profile and confirm ink treatment and technical details
before final print export. The review sheet is enlarged; use the individual
PDFs for dimensions.

## Regenerate

Use Python with `reportlab`, `pymupdf`, `pypdf`, `fonttools[woff]`, `pillow`, and
`qrcode`, then run from the repository root:

```sh
python scripts/export-label-assets.py --template '/path/to/-kivennaisvesi (2).ai'
```

The generator uses the existing `assets/fonts/*.woff2` files and the macOS
Arial Black font for the official square mark. It checks text safety margins,
trim dimensions, absence of raster images, and the source file's unchanged hash.
`verification.json` records the geometry and production assumptions.
